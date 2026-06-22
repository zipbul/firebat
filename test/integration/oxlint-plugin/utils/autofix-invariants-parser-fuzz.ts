import { parseSync as oxcParseSync } from 'oxc-parser';

import type { AstNode, RuleContext, Variable } from '../../../../src/test-api';

import { blankLinesBetweenStatementGroupsRule } from '../../../../src/test-api';
import { noBracketNotationRule } from '../../../../src/test-api';
import { paddingLineBetweenStatementsRule } from '../../../../src/test-api';
import { unusedImportsRule } from '../../../../src/test-api';
import {
  collectIdentifierUsages,
  ensureRangesDeep,
  isAstNode,
  traverseAndVisit,
  type RuleModule,
  type Visitor,
} from './ast-walk';
import {
  buildUniqueIdentifiers,
  getRange as getRangeTuple,
  makeIdentifier,
  makeUnsafeKey,
  mulberry32,
  newline,
  whitespace,
} from './fuzz-rng';
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

interface RuleRunResult {
  reports: ReturnType<typeof createRuleContext>['reports'];
  fixed: string;
}

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

      const references = collectIdentifierUsages(program, localName, importRange, getRangeTuple);

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
      const code = `const x = ${multi ? `obj[${nl}${wsL}'${key}'${wsR}${nl}]` : `obj[${wsL}'${key}'${wsR}]`};`;
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
      const names = buildUniqueIdentifiers(rng, count);
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
      const importLine = `${importKind === 'type' ? 'import type' : 'import'}${ws1}{${ws1}${spec}${ws1}}${ws1}from${ws1}'x';`;
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
      const mode = rng.pick(['const-const', 'const-fn'] as const);
      const a = makeIdentifier(rng, 3, 8);
      const b = makeIdentifier(rng, 3, 8);
      const stmtA = `const ${a} = 1;`;
      const code = `${stmtA}${hasBlank ? `${nl}${nl}` : nl}${mode === 'const-fn' ? `function ${b}() {}` : `const ${b} = 2;`}${nl}`;
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
      const f = makeIdentifier(rng, 3, 8);
      const v = makeIdentifier(rng, 3, 8);
      const stmtA = `function ${f}() {}`;
      const stmtB = `const ${v} = 1;`;
      const code = `${stmtA}${hasBlank ? `${nl}${nl}` : nl}${stmtB}${nl}`;
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

export { runParserAutofixInvariantsFuzz };
