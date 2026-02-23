import { parseSync as oxcParseSync, type Program } from 'oxc-parser';

import type { AstNode, AstNodeValue, RuleContext, Variable } from '../../../../src/test-api';

import { blankLinesBetweenStatementGroupsRule } from '../../../../src/test-api';
import { noBracketNotationRule } from '../../../../src/test-api';
import { paddingLineBetweenStatementsRule } from '../../../../src/test-api';
import { unusedImportsRule } from '../../../../src/test-api';
import { applyFixes, createRuleContext, createSourceCode } from './rule-test-kit';
import { buildCommaTokens } from './token-utils';

interface ParseSyncResult {
  program: AstNode;
}

type ParseSync = (filename: string, code: string) => ParseSyncResult;

const parseSync: ParseSync = (filename, code) => {
  const parsed = oxcParseSync(filename, code);
  const programValue = parsed.program;

  if (!isAstNode(programValue)) {
    throw new Error('Invalid parse result');
  }

  return { program: programValue };
};

interface Visitor {
  [key: string]: ((node: AstNode) => void) | undefined;
}

interface RuleModule {
  create(context: RuleContext): Visitor;
}

interface Rng {
  nextU32(): number;
  int(min: number, maxInclusive: number): number;
  bool(pTrue: number): boolean;
  pick<T>(items: readonly T[]): T;
}

interface RuleRunResult {
  reports: ReturnType<typeof createRuleContext>['reports'];
  fixed: string;
}

interface AstNodeShape {
  type?: string;
}

const mulberry32 = (seed: number): Rng => {
  let t = seed >>> 0;

  const nextU32 = (): number => {
    t += 0x6d2b79f5;

    let x = t;

    x = Math.imul(x ^ (x >>> 15), x | 1);

    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);

    return (x ^ (x >>> 14)) >>> 0;
  };

  return {
    nextU32,
    int(min: number, maxInclusive: number): number {
      if (maxInclusive < min) {
        throw new Error('invalid int range');
      }

      const span = maxInclusive - min + 1;

      return min + (nextU32() % span);
    },
    bool(pTrue: number): boolean {
      const threshold = Math.max(0, Math.min(1, pTrue));
      const x = nextU32() / 0x1_0000_0000;

      return x < threshold;
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) {
        throw new Error('cannot pick from empty list');
      }

      const item = items[nextU32() % items.length];

      if (item === undefined) {
        throw new Error('random pick failed');
      }

      return item;
    },
  };
};

const makeIdentifier = (rng: Rng, minLen = 1, maxLen = 10): string => {
  const firstChars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$';
  const nextChars = firstChars + '0123456789';
  const len = rng.int(minLen, maxLen);
  let out = rng.pick(firstChars.split(''));

  for (let i = 1; i < len; i += 1) {
    out += rng.pick(nextChars.split(''));
  }

  return out;
};

const makeUnsafeKey = (rng: Rng): string => {
  const parts = ['not-valid', 'with space', 'kebab-case', 'has.dot', '0starts', 'x-y', 'a:b'];
  const base = rng.pick(parts);

  if (rng.bool(0.5)) {
    return `${base}-${rng.int(0, 9)}`;
  }

  return base;
};

const whitespace = (rng: Rng): string => rng.pick(['', ' ', '  ', '\t']);

const newline = (rng: Rng): string => (rng.bool(0.5) ? '\n' : '\r\n');

const isAstNode = (value: AstNodeValue | AstNodeShape | Program | null | undefined): value is AstNode => {
  if (value === null || value === undefined) {
    return false;
  }

  if (Array.isArray(value)) {
    return false;
  }

  if (typeof value !== 'object') {
    return false;
  }

  if (!('type' in value)) {
    return false;
  }

  return typeof value.type === 'string';
};

const ensureRangesDeep = (root: AstNodeValue | null | undefined): void => {
  const seen = new WeakSet<AstNode>();

  const walk = (value: AstNodeValue | null | undefined): void => {
    if (value === null || value === undefined) {
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item);
      }

      return;
    }

    if (!isAstNode(value)) {
      return;
    }

    if (seen.has(value)) {
      return;
    }

    seen.add(value);

    const start = value.start;
    const end = value.end;
    const range = value.range;

    if (!Array.isArray(range) && typeof start === 'number' && typeof end === 'number') {
      value.range = [start, end];
    }

    for (const key of Object.keys(value)) {
      if (key === 'parent') {
        continue;
      }

      const child = value[key];

      if (Array.isArray(child)) {
        for (const item of child) {
          walk(item);
        }

        continue;
      }

      walk(child);
    }
  };

  walk(root);
};

const traverseAndVisit = (root: AstNodeValue | null | undefined, visitor: Visitor): void => {
  const seen = new WeakSet<AstNode>();

  const walk = (value: AstNodeValue | null | undefined): void => {
    if (value === null || value === undefined) {
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item);
      }

      return;
    }

    if (!isAstNode(value)) {
      return;
    }

    if (seen.has(value)) {
      return;
    }

    seen.add(value);

    const handler = visitor[value.type];

    if (typeof handler === 'function') {
      handler(value);
    }

    for (const key of Object.keys(value)) {
      if (key === 'parent') {
        continue;
      }

      const child = value[key];

      if (Array.isArray(child)) {
        for (const item of child) {
          walk(item);
        }

        continue;
      }

      walk(child);
    }
  };

  walk(root);
};

const getRangeTuple = (node: AstNode | null | undefined): [number, number] | null => {
  if (!node || !Array.isArray(node.range) || node.range.length !== 2) {
    return null;
  }

  const start = node.range[0];
  const end = node.range[1];

  if (typeof start !== 'number' || typeof end !== 'number') {
    return null;
  }

  return [start, end];
};

const collectIdentifierUsages = (
  root: AstNodeValue | null | undefined,
  name: string,
  excludeRange: [number, number] | null,
): AstNode[] => {
  const out: AstNode[] = [];

  traverseAndVisit(root, {
    Identifier(node) {
      if (typeof node.name !== 'string' || node.name !== name) {
        return;
      }

      const range = getRangeTuple(node);

      if (!range) {
        return;
      }

      const excludeStart = excludeRange?.[0];
      const excludeEnd = excludeRange?.[1];

      if (excludeStart !== undefined && excludeEnd !== undefined && range[0] >= excludeStart && range[1] <= excludeEnd) {
        return;
      }

      out.push(node);
    },
  });

  return out;
};

const runRuleOnParsedCode = (
  filename: string,
  code: string,
  rule: RuleModule,
  options: RuleContext['options'] = [],
): RuleRunResult => {
  const parsed = parseSync(filename, code);
  const program = parsed.program;

  if (!isAstNode(program)) {
    return { reports: [], fixed: code };
  }

  ensureRangesDeep(program);

  const tokens = buildCommaTokens(code);
  const sourceCode = createSourceCode(code, null, null, tokens);

  const getDeclaredVariables = (node: AstNode): Variable[] => {
    if (node.type !== 'ImportDeclaration') {
      return [];
    }

    const specifiers = Array.isArray(node.specifiers) ? node.specifiers : [];
    const importRange = getRangeTuple(node);
    const vars: Variable[] = [];

    for (const spec of specifiers) {
      const local = spec.local;
      const localName = typeof local?.name === 'string' ? local.name : null;
      const localRange = getRangeTuple(local ?? null);

      if (typeof localName !== 'string' || localName.length === 0 || !localRange) {
        continue;
      }

      const references = collectIdentifierUsages(program, localName, importRange);

      vars.push({
        identifiers: [{ type: 'Identifier', range: localRange, name: localName }],
        references,
      } satisfies Variable);
    }

    return vars;
  };

  const { context, reports } = createRuleContext(sourceCode, options, getDeclaredVariables);
  const visitor = rule.create(context);

  traverseAndVisit(program, visitor);

  const fixed = applyFixes(code, reports);

  return { reports, fixed };
};

const runParserAutofixInvariantsFuzz = (): void => {
  const seeds = [101, 102, 103, 104, 105, 4242];

  for (const seed of seeds) {
    const rng = mulberry32(seed);

    for (let i = 0; i < 120; i += 1) {
      const safe = rng.bool(0.7);
      const multi = rng.bool(0.2);
      const key = safe ? makeIdentifier(rng, 1, 8) : makeUnsafeKey(rng);
      const wsL = whitespace(rng);
      const wsR = whitespace(rng);
      const nl = newline(rng);
      const member = multi ? `obj[${nl}${wsL}'${key}'${wsR}${nl}]` : `obj[${wsL}'${key}'${wsR}]`;
      const code = `const x = ${member};`;
      const r1 = runRuleOnParsedCode('no-bracket-notation.ts', code, noBracketNotationRule);

      if (r1.reports.length <= 0) {
        throw new Error('Expected at least one report for no-bracket-notation fuzz input.');
      }

      if (r1.fixed !== code) {
        parseSync('no-bracket-notation-fixed.ts', r1.fixed);

        const r2 = runRuleOnParsedCode('no-bracket-notation-fixed.ts', r1.fixed, noBracketNotationRule);

        if (r2.reports.length !== 0) {
          throw new Error('Expected no-bracket-notation to be idempotent after fix.');
        }
      }
    }
  }

  const importSeeds = [201, 202, 203, 204, 205, 90001];

  for (const seed of importSeeds) {
    const rng = mulberry32(seed);

    for (let i = 0; i < 140; i += 1) {
      const count = rng.int(1, 4);
      const names: string[] = [];

      while (names.length < count) {
        const candidate = makeIdentifier(rng, 1, 8);

        if (!names.includes(candidate)) {
          names.push(candidate);
        }
      }

      const importKind = rng.bool(0.1) ? 'type' : null;
      const multiline = rng.bool(0.15);
      const ws1 = whitespace(rng);
      const ws2 = whitespace(rng);
      const nl = newline(rng);
      const used = new Set<string>();

      for (const name of names) {
        if (rng.bool(0.55)) {
          used.add(name);
        }
      }

      if (used.size === names.length) {
        used.delete(rng.pick(names));
      }

      const spec = names
        .map((name, idx) => {
          if (idx === 0) {
            return name;
          }

          return multiline ? `,${nl}${ws2}${name}` : `,${ws2}${name}`;
        })
        .join('');
      const importPrefix = importKind === 'type' ? 'import type' : 'import';
      const importLine = `${importPrefix}${ws1}{${ws1}${spec}${ws1}}${ws1}from${ws1}'x';`;
      const usageLines = names
        .filter(name => used.has(name))
        .map(name => `console.log(${name});`)
        .join(nl);
      const code = usageLines.length > 0 ? `${importLine}${nl}${usageLines}${nl}` : `${importLine}${nl}`;
      const r1 = runRuleOnParsedCode('unused-imports.ts', code, unusedImportsRule);

      if (r1.reports.length <= 0) {
        throw new Error('Expected unused-imports to report at least one violation.');
      }

      if (importKind === 'type') {
        if (r1.fixed !== code) {
          throw new Error('Type-only imports must not be autofixed.');
        }
        continue;
      }

      if (r1.fixed !== code) {
        parseSync('unused-imports-fixed.ts', r1.fixed);

        const r2 = runRuleOnParsedCode('unused-imports-fixed.ts', r1.fixed, unusedImportsRule);

        if (r2.reports.length !== 0) {
          throw new Error('Expected unused-imports to be idempotent after fix.');
        }
      }
    }
  }

  const paddingSeeds = [301, 302, 303, 304, 305];

  for (const seed of paddingSeeds) {
    const rng = mulberry32(seed);

    for (let i = 0; i < 160; i += 1) {
      const nl = newline(rng);
      const hasBlank = rng.bool(0.45);
      const between = hasBlank ? `${nl}${nl}` : nl;
      const mode = rng.pick(['const-const', 'const-fn'] as const);
      const a = makeIdentifier(rng, 3, 8);
      const b = makeIdentifier(rng, 3, 8);
      const stmtA = `const ${a} = 1;`;
      const stmtB = mode === 'const-fn' ? `function ${b}() {}` : `const ${b} = 2;`;
      const code = `${stmtA}${between}${stmtB}${nl}`;
      const r1 = runRuleOnParsedCode('padding.ts', code, paddingLineBetweenStatementsRule);

      if (r1.fixed !== code) {
        parseSync('padding-fixed.ts', r1.fixed);

        const r2 = runRuleOnParsedCode('padding-fixed.ts', r1.fixed, paddingLineBetweenStatementsRule);

        if (r2.reports.length !== 0) {
          throw new Error('Expected padding-line-between-statements to be idempotent.');
        }
      }
    }
  }

  const blankLineSeeds = [401, 402, 403, 404, 405];

  for (const seed of blankLineSeeds) {
    const rng = mulberry32(seed);

    for (let i = 0; i < 140; i += 1) {
      const nl = newline(rng);
      const hasBlank = rng.bool(0.25);
      const between = hasBlank ? `${nl}${nl}` : nl;
      const f = makeIdentifier(rng, 3, 8);
      const v = makeIdentifier(rng, 3, 8);
      const stmtA = `function ${f}() {}`;
      const stmtB = `const ${v} = 1;`;
      const code = `${stmtA}${between}${stmtB}${nl}`;
      const r1 = runRuleOnParsedCode('blank-lines.ts', code, blankLinesBetweenStatementGroupsRule);

      if (r1.fixed !== code) {
        parseSync('blank-lines-fixed.ts', r1.fixed);

        const r2 = runRuleOnParsedCode('blank-lines-fixed.ts', r1.fixed, blankLinesBetweenStatementGroupsRule);

        if (r2.reports.length !== 0) {
          throw new Error('Expected blank-lines-between-statement-groups to be idempotent.');
        }
      }
    }
  }
};

const canRunParserAutofixInvariantsFuzz = (): boolean => {
  return typeof parseSync === 'function';
};

export { runParserAutofixInvariantsFuzz, canRunParserAutofixInvariantsFuzz };
