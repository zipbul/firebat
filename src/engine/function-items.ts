import type { Node } from 'oxc-parser';

import type { NestingReductionMetrics, SourceSpan } from '../types';
import type { ParsedFile } from './types';

import { collectFunctionNodesWithParent } from './ast';
import { getNodeHeader } from './ast/oxc-ast-utils';
import { spanOfNode } from './ast/source-span';

type FunctionNodeAnalyzer<TItem> = (node: Node, filePath: string, sourceText: string, parent: Node | null) => TItem | null;

const collectFunctionItemsFromFile = <TItem>(
  file: ParsedFile,
  analyzeFunctionNode: FunctionNodeAnalyzer<TItem>,
  items: TItem[],
): void => {
  const functions = collectFunctionNodesWithParent(file.program);

  for (const { node, parent } of functions) {
    const item = analyzeFunctionNode(node, file.filePath, file.sourceText, parent);

    if (item === null || item === undefined) {
      continue;
    }

    items.push(item);
  }
};

const collectFunctionItems = <TItem>(
  files: ReadonlyArray<ParsedFile>,
  analyzeFunctionNode: FunctionNodeAnalyzer<TItem>,
): ReadonlyArray<TItem> => {
  const items: TItem[] = [];

  for (const file of files) {
    if (file.errors.length > 0) {
      continue;
    }

    collectFunctionItemsFromFile(file, analyzeFunctionNode, items);
  }

  return items;
};

/**
 * 한 함수 안에서 발견된 "중첩 줄이기" 기회 하나.
 * early-return / collapsible-if 가 공유하는 모델.
 */
interface NestingReductionOpportunity<TKind> {
  readonly kind: TKind;
  readonly span: SourceSpan;
  readonly depthReduction: number;
  readonly statementsAffected: number;
}

interface NestingReductionItem<TKind> {
  readonly kind: TKind;
  readonly file: string;
  readonly header: string;
  readonly span: SourceSpan;
  readonly opportunitySpans?: ReadonlyArray<SourceSpan>;
  readonly metrics: NestingReductionMetrics;
  readonly score: number;
}

/**
 * 중첩 줄이기 기회들의 총점 = Σ(depthReduction × statementsAffected).
 * early-return / collapsible-if 가 임계 비교에 쓰는 점수의 단일 변경지점.
 */
const computeNestingReductionScore = <TKind>(opportunities: ReadonlyArray<NestingReductionOpportunity<TKind>>): number =>
  opportunities.reduce((sum, o) => sum + o.depthReduction * o.statementsAffected, 0);

/**
 * 함수 단위 finding 조립: 영향도(depthReduction × statementsAffected)가 가장 큰
 * 기회의 kind를 대표 kind로 삼고, 메트릭을 합산한다.
 * `opportunities` 는 비어 있지 않다고 가정한다 (호출부에서 보장).
 */
const buildNestingReductionItem = <TKind>(
  functionNode: Node,
  filePath: string,
  sourceText: string,
  parent: Node | null,
  opportunities: ReadonlyArray<NestingReductionOpportunity<TKind>>,
  maxDepth: number,
  totalScore: number,
): NestingReductionItem<TKind> => {
  const primaryOpportunity = opportunities.reduce((best, o) =>
    o.depthReduction * o.statementsAffected > best.depthReduction * best.statementsAffected ? o : best,
  );
  const header = getNodeHeader(functionNode, parent);
  const span = spanOfNode(functionNode, sourceText);

  return {
    kind: primaryOpportunity.kind,
    file: filePath,
    header,
    span,
    ...(opportunities.length > 0 ? { opportunitySpans: opportunities.map(o => o.span) } : {}),
    metrics: {
      maxDepth,
      depthReduction: opportunities.reduce((sum, o) => sum + o.depthReduction, 0),
      statementsAffected: opportunities.reduce((sum, o) => sum + o.statementsAffected, 0),
    },
    score: totalScore,
  };
};

export { buildNestingReductionItem, collectFunctionItems, computeNestingReductionScore };
