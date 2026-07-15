/**
 * Statement-run(함수 내부 연속 문장열) 클론 탐지.
 *
 * 선언 단위 매칭(analyzer.ts)이 못 잡는 "함수 경계 안의 복붙된 문장 덩어리"를
 * AST 정규형으로 잡는다. CLAUDE.md duplicates 닫힌 규칙:
 *  - 경계: 한 BlockStatement.body의 연속 형제 문장만
 *  - 최소 크기: 정규형 AST 노드 수 ≥ minSize
 *  - 추출 안전성: live-out ≤ 1, 제어 이탈 없음
 *  - 중첩: 같은 시그니처의 최대 run만
 */

import type { Node } from 'oxc-parser';

import { visitorKeys } from 'oxc-parser';

import type { ParsedFile } from '../../engine/types';
import type { DuplicateGroup, DuplicateItem, ExtractionPlan, SourceSpan } from '../../types';

import {
  asRecord,
  collectBindingNames,
  collectOxcNodes,
  countOxcSize,
  createOxcFingerprintRun,
  createOxcFingerprintShapeWithBindings,
  isOxcNode,
} from '../../engine/ast';
import { resolveSpan } from './clone-targets';

/**
 * 노드의 각 visitorKey에 매달린 자식 노드를 방문한다 (단일 노드·노드 배열 모두).
 * 여러 walk 클로저가 같은 자식 디스패치를 복제하던 것을 한 곳으로 모은다.
 * `onChild`가 false를 반환하면 해당 key의 자식을 건너뛴다 (필터용).
 */
const visitChildNodes = (node: Node, onChild: (child: Node, key: string) => boolean | void): void => {
  const rec = asRecord(node);
  const keys = visitorKeys[node.type];

  if (keys === undefined) {
    return;
  }

  for (const key of keys) {
    const value = rec[key];

    if (isOxcNode(value)) {
      onChild(value, key);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (isOxcNode(item)) {
          onChild(item, key);
        }
      }
    }
  }
};

// ─── 내부 모델 ───────────────────────────────────────────────────────────────

interface BlockInfo {
  readonly filePath: string;
  readonly sourceText: string;
  readonly statements: ReadonlyArray<Node>;
  readonly fps: ReadonlyArray<string>;
  readonly sizes: ReadonlyArray<number>;
  /** 둘러싼 함수의 바인딩 이름 — 추출 시 파라미터(외부 지역변수) 계산용. */
  readonly boundNames: ReadonlySet<string>;
}

interface RunOccurrence {
  readonly blockIdx: number;
  readonly start: number;
  readonly length: number;
}

const FUNCTION_BODY_OWNERS = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'MethodDefinition',
]);

// ─── Public API ──────────────────────────────────────────────────────────────

interface FragmentDetectorOptions {
  readonly minSize: number;
}

/** 후보 run 그룹의 판정 — 골든이 "고려 후 거부"를 증명할 수 있게 사유를 노출한다. */
type FragmentVerdict =
  | { readonly outcome: 'reported' }
  | { readonly outcome: 'rejected'; readonly reason: 'below-min-size' | 'multiple-live-outs' | 'control-escape' };

interface FragmentCandidate {
  readonly sites: number;
  readonly runSize: number;
  readonly verdict: FragmentVerdict;
}

interface FragmentAnalysis {
  readonly groups: ReadonlyArray<DuplicateGroup>;
  readonly candidates: ReadonlyArray<FragmentCandidate>;
}

const analyzeFragments = (files: ReadonlyArray<ParsedFile>, options: FragmentDetectorOptions): FragmentAnalysis => {
  const blocks = collectBlocks(files);

  if (blocks.length === 0) {
    return { groups: [], candidates: [] };
  }

  // ── 시그니처별 최대 run 수집 (블록 쌍 비교) ──────────────────────────────────
  const runsBySignature = new Map<string, RunOccurrence[]>();

  const record = (sig: string, occ: RunOccurrence): void => {
    const list = runsBySignature.get(sig);

    if (list === undefined) {
      runsBySignature.set(sig, [occ]);

      return;
    }

    // 동일 위치 중복 방지
    const dup = list.some(o => o.blockIdx === occ.blockIdx && o.start === occ.start && o.length === occ.length);

    if (!dup) {
      list.push(occ);
    }
  };

  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      collectMaximalRuns(blocks[i]!, i, blocks[j]!, j, record);
    }
  }

  // ── 후보 판정 (사유 기록) ─────────────────────────────────────────────────────
  const groups: DuplicateGroup[] = [];
  const candidates: FragmentCandidate[] = [];

  for (const rawOccurrences of runsBySignature.values()) {
    // 반복 문장(tandem repeat)에서 생기는 같은 블록 내 겹치는 run을 제거 — 겹치는 두
    // 슬라이스를 서로의 클론으로 보고하는 비일관(둘 다 추출 불가)을 막는다.
    const occurrences = dropOverlappingOccurrences(rawOccurrences);

    if (occurrences.length < 2) {
      continue;
    }

    const rep = occurrences[0]!;
    const repBlock = blocks[rep.blockIdx]!;
    const runSize = sumRange(repBlock.sizes, rep.start, rep.length);
    const verdict = classifyCandidate(repBlock, rep, runSize, options.minSize);

    candidates.push({ sites: occurrences.length, runSize, verdict });

    if (verdict.outcome === 'reported') {
      const items = dedupeItems(occurrences.map(occ => toFragmentItem(blocks[occ.blockIdx]!, occ)));

      groups.push({
        cloneType: 'fragment',
        findingKind: 'fragment-clone',
        items,
        suggestedExtraction: buildExtractionPlan(repBlock, rep.start, rep.length),
      });
    }
  }

  return { groups: groups.filter(g => g.items.length >= 2), candidates };
};

/** 같은 블록 내에서 statement 범위가 겹치는 occurrence를 제거 (이른 시작 우선). */
const dropOverlappingOccurrences = (occurrences: ReadonlyArray<RunOccurrence>): RunOccurrence[] => {
  const sorted = [...occurrences].sort((a, b) => (a.blockIdx !== b.blockIdx ? a.blockIdx - b.blockIdx : a.start - b.start));
  const kept: RunOccurrence[] = [];
  const lastEndByBlock = new Map<number, number>();

  for (const occ of sorted) {
    const lastEnd = lastEndByBlock.get(occ.blockIdx);

    if (lastEnd !== undefined && occ.start < lastEnd) {
      continue; // 같은 블록에서 직전 kept run과 겹침 → 버림
    }

    kept.push(occ);
    lastEndByBlock.set(occ.blockIdx, occ.start + occ.length);
  }

  return kept;
};

const classifyCandidate = (block: BlockInfo, rep: RunOccurrence, runSize: number, minSize: number): FragmentVerdict => {
  // statement-run은 "연속된 형제 문장 덩어리"(≥2). 단일 문장의 반복은 run이 아니라 상수/표현식
  // 중복(redundancy 영역, 비대상)이다 — 큰 단일 문장이 minSize를 넘겨도 보고하지 않는다.
  if (rep.length < 2) {
    return { outcome: 'rejected', reason: 'below-min-size' };
  }

  if (runSize < minSize) {
    return { outcome: 'rejected', reason: 'below-min-size' };
  }

  const safety = extractSafety(block, rep.start, rep.length);

  if (safety !== 'ok') {
    return { outcome: 'rejected', reason: safety };
  }

  return { outcome: 'reported' };
};

export const detectFragmentClones = (
  files: ReadonlyArray<ParsedFile>,
  options: FragmentDetectorOptions,
): ReadonlyArray<DuplicateGroup> => analyzeFragments(files, options).groups;

/** 골든 보조: 어떤 후보 run이 어떤 사유로 거부됐는지 노출 (vacuous K 방지 검증용). */
export const explainFragments = (
  files: ReadonlyArray<ParsedFile>,
  options: FragmentDetectorOptions,
): ReadonlyArray<FragmentCandidate> => analyzeFragments(files, options).candidates;

// ─── 블록 수집 ───────────────────────────────────────────────────────────────

const collectBlocks = (files: ReadonlyArray<ParsedFile>): BlockInfo[] => {
  const blocks: BlockInfo[] = [];

  for (const file of files) {
    if (file.errors.length > 0) {
      continue;
    }

    for (const fn of collectOxcNodes(file.program, n => FUNCTION_BODY_OWNERS.has(n.type))) {
      const body = getFunctionBody(fn);

      if (body === null) {
        continue;
      }

      // 함수의 모든 바인딩으로 정규형 통일 후, 함수 본문 + 그 안의 모든 중첩 블록을
      // 각각 candidate 블록으로 수집한다 (CLAUDE.md: "한 BlockStatement.body" = 모든 블록).
      const boundNames = collectBindingNames(fn);

      addBlockTree(blocks, file.filePath, file.sourceText, fn, boundNames);
    }
  }

  return blocks;
};

/** fn 본문과 그 안의 중첩 BlockStatement.body들을 블록으로 추가 (중첩 함수는 자기 스코프로 별도 처리). */
const addBlockTree = (
  out: BlockInfo[],
  filePath: string,
  sourceText: string,
  fn: Node,
  boundNames: ReadonlySet<string>,
): void => {
  const seenBodies = new Set<ReadonlyArray<Node>>();
  const fnBody = getFunctionBody(fn);

  const pushBlock = (statements: ReadonlyArray<Node>): void => {
    if (statements.length < 2 || seenBodies.has(statements)) {
      return;
    }

    seenBodies.add(statements);
    out.push({
      filePath,
      sourceText,
      statements,
      fps: statements.map(stmt => createOxcFingerprintShapeWithBindings(stmt, boundNames)),
      sizes: statements.map(stmt => countOxcSize(stmt)),
      boundNames,
    });
  };

  const walk = (n: Node): void => {
    // 중첩 함수는 collectBlocks 상위 순회가 자기 boundNames로 따로 다룬다 → 멈춤
    if (n !== fn && FUNCTION_BODY_OWNERS.has(n.type)) {
      return;
    }

    if (n.type === 'BlockStatement' || n.type === 'StaticBlock') {
      pushBlock((n as Node & { readonly body: ReadonlyArray<Node> }).body);
    }

    if (n.type === 'SwitchCase') {
      pushBlock((n as Node & { readonly consequent: ReadonlyArray<Node> }).consequent);
    }

    visitChildNodes(n, child => {
      walk(child);
    });
  };

  if (fnBody !== null) {
    walk(fn);
  }
};

const getFunctionBody = (fn: Node): ReadonlyArray<Node> | null => {
  const rec = asRecord(fn);

  // MethodDefinition → value(FunctionExpression) → body
  if (fn.type === 'MethodDefinition') {
    const value = rec.value;

    return isOxcNode(value) ? getFunctionBody(value) : null;
  }

  const body = rec.body;

  if (isOxcNode(body) && body.type === 'BlockStatement') {
    const block = body as Node & { readonly body: ReadonlyArray<Node> };

    return block.body;
  }

  return null;
};

// ─── 최대 run 추출 (두 블록) ──────────────────────────────────────────────────

const collectMaximalRuns = (
  a: BlockInfo,
  aIdx: number,
  b: BlockInfo,
  bIdx: number,
  record: (sig: string, occ: RunOccurrence) => void,
): void => {
  const aLen = a.fps.length;
  const bLen = b.fps.length;

  for (let si = 0; si < aLen; si++) {
    for (let sj = 0; sj < bLen; sj++) {
      if (a.fps[si] !== b.fps[sj]) {
        continue;
      }

      // 최대 시작점만: 직전 문장이 같으면 더 긴 run의 일부이므로 skip
      if (si > 0 && sj > 0 && a.fps[si - 1] === b.fps[sj - 1]) {
        continue;
      }

      let k = 0;

      while (si + k < aLen && sj + k < bLen && a.fps[si + k] === b.fps[sj + k]) {
        k++;
      }

      // 같은 블록 내 자기 자신과의 겹침(si==sj) 방지
      if (aIdx === bIdx && si === sj) {
        continue;
      }

      // 문장별 fps는 위치 독립 후보 필터일 뿐 — 문장 사이 바인딩 동일참조(co-reference)를
      // 잃는다(`v;v`와 `k;i`가 문장 단위로는 동형). 런 전체에 rename 맵을 공유한 런-정규형으로
      // 다시 비교해, 동일참조까지 일치하는 진짜 클론만 그룹화한다(거짓병합 방지).
      const sigA = createOxcFingerprintRun(a.statements.slice(si, si + k), a.boundNames);
      const sigB = createOxcFingerprintRun(b.statements.slice(sj, sj + k), b.boundNames);

      if (sigA !== sigB) {
        continue;
      }

      record(sigA, { blockIdx: aIdx, start: si, length: k });
      record(sigA, { blockIdx: bIdx, start: sj, length: k });
    }
  }
};

// ─── 추출 안전성 ──────────────────────────────────────────────────────────────

/** 문장 런이 선언하는 모든 바인딩 이름을 모은다. */
const collectDeclaredNames = (run: ReadonlyArray<Node>): Set<string> => {
  const declared = new Set<string>();

  for (const stmt of run) {
    for (const name of collectBindingNames(stmt)) {
      declared.add(name);
    }
  }

  return declared;
};

/** 추출 계획: 파라미터(외부 지역변수)·반환값(단일 live-out)·this 사용 — 전부 결정적. */
const buildExtractionPlan = (block: BlockInfo, start: number, length: number): ExtractionPlan => {
  const run = block.statements.slice(start, start + length);
  const after = block.statements.slice(start + length);
  const declared = collectDeclaredNames(run);
  const referenced = collectReferencedNames(run);
  // 파라미터 = 런이 읽지만 런 밖(둘러싼 함수)에서 선언된 지역변수. 전역·callee는 boundNames에 없어 제외.
  const params = [...referenced].filter(n => block.boundNames.has(n) && !declared.has(n)).sort();
  const afterRefs = collectReferencedNames(after);
  const liveOuts = [...declared].filter(n => afterRefs.has(n)).sort();

  return {
    params,
    returns: liveOuts[0] ?? null,
    usesThis: run.some(referencesThis),
  };
};

const referencesThis = (node: Node): boolean => {
  let found = false;

  const walk = (n: Node): void => {
    if (found) {
      return;
    }

    if (n.type === 'ThisExpression') {
      found = true;

      return;
    }

    // 중첩 함수의 this는 별개 — 단, arrow는 this를 상속하므로 멈추지 않는다
    if (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression') {
      return;
    }

    visitChildNodes(n, child => {
      walk(child);
    });
  };

  walk(node);

  return found;
};

type ExtractSafety = 'ok' | 'multiple-live-outs' | 'control-escape';

const extractSafety = (block: BlockInfo, start: number, length: number): ExtractSafety => {
  const run = block.statements.slice(start, start + length);
  const after = block.statements.slice(start + length);
  // 마지막 top-level return은 추출 가능: 헬퍼가 그 값을 반환하고 호출자가 `return helper()`.
  // 그 외 위치의 return·break·continue는 제어 이탈 → 추출 불가.
  const last = run[run.length - 1];
  const body = last !== undefined && last.type === 'ReturnStatement' ? run.slice(0, -1) : run;

  if (body.some(hasControlEscape)) {
    return 'control-escape';
  }

  // live-out: run에서 선언한 바인딩 중 run 밖에서 쓰이는 것
  const declared = collectDeclaredNames(run);

  if (declared.size === 0) {
    return 'ok';
  }

  const afterRefs = collectReferencedNames(after);
  let liveOuts = 0;

  for (const name of declared) {
    if (afterRefs.has(name)) {
      liveOuts++;
    }
  }

  return liveOuts <= 1 ? 'ok' : 'multiple-live-outs';
};

// return + yield/await: yield는 generator 프로토콜에, await는 async coloring에 묶여
// 위치를 보존해야 추출이 안전하다 (CLAUDE.md waste: await/yield 위치 보존).
const CONTROL_ESCAPE_TYPES = new Set(['ReturnStatement', 'YieldExpression', 'AwaitExpression']);
const LOOP_TYPES = new Set(['ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement']);

/** run 노드가 자신의 경계 밖으로 제어를 넘기거나(return/break/continue) yield·await를 포함하는지 */
const hasControlEscape = (node: Node): boolean => {
  let escape = false;

  const walk = (n: Node, loopDepth: number, switchDepth: number): void => {
    if (escape) {
      return;
    }

    if (CONTROL_ESCAPE_TYPES.has(n.type)) {
      escape = true;

      return;
    }

    if (n.type === 'BreakStatement' && loopDepth === 0 && switchDepth === 0) {
      escape = true;

      return;
    }

    if (n.type === 'ContinueStatement' && loopDepth === 0) {
      escape = true;

      return;
    }

    // 함수 경계에서 멈춤 (중첩 함수 내부의 return은 무관)
    if (n !== node && FUNCTION_BODY_OWNERS.has(n.type)) {
      return;
    }

    const nextLoop = LOOP_TYPES.has(n.type) ? loopDepth + 1 : loopDepth;
    const nextSwitch = n.type === 'SwitchStatement' ? switchDepth + 1 : switchDepth;

    visitChildNodes(n, child => {
      walk(child, nextLoop, nextSwitch);
    });
  };

  walk(node, 0, 0);

  return escape;
};

/** 노드 목록에서 참조된 식별자 이름 (프로퍼티명 제외) */
const collectReferencedNames = (nodes: ReadonlyArray<Node>): ReadonlySet<string> => {
  const names = new Set<string>();

  const walk = (n: Node): void => {
    const rec = asRecord(n);

    if (n.type === 'Identifier') {
      names.add((n as Node & { readonly name: string }).name);
    }

    visitChildNodes(n, (child, key) => {
      // member property / object key 는 참조가 아님 → skip
      if (
        (n.type === 'MemberExpression' && key === 'property' && rec.computed !== true) ||
        (n.type === 'Property' && key === 'key' && rec.computed !== true)
      ) {
        return;
      }

      walk(child);
    });
  };

  for (const node of nodes) {
    walk(node);
  }

  return names;
};

// ─── 변환 / 유틸 ─────────────────────────────────────────────────────────────

const sumRange = (sizes: ReadonlyArray<number>, start: number, length: number): number => {
  let total = 0;

  for (let i = start; i < start + length; i++) {
    total += sizes[i]!;
  }

  return total;
};

const toFragmentItem = (block: BlockInfo, occ: RunOccurrence): DuplicateItem => {
  const first = block.statements[occ.start]!;
  const last = block.statements[occ.start + occ.length - 1]!;
  const span: SourceSpan = {
    start: resolveSpan(block.sourceText, first).start,
    end: resolveSpan(block.sourceText, last).end,
  };

  return {
    kind: 'node',
    header: `${occ.length} statements`,
    filePath: block.filePath,
    span,
  };
};

const dedupeItems = (items: ReadonlyArray<DuplicateItem>): DuplicateItem[] => {
  const seen = new Set<string>();
  const out: DuplicateItem[] = [];

  for (const item of items) {
    const key = `${item.filePath}:${item.span.start.line}:${item.span.start.column}:${item.span.end.line}`;

    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }

  return out.sort((a, b) => {
    if (a.filePath !== b.filePath) {
      return a.filePath < b.filePath ? -1 : 1;
    }

    return a.span.start.line - b.span.start.line;
  });
};
