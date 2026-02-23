import type { AstNode, Variable } from '../../../../src/test-api';

import { blankLinesBetweenStatementGroupsRule } from '../../../../src/test-api';
import { noBracketNotationRule } from '../../../../src/test-api';
import { paddingLineBetweenStatementsRule } from '../../../../src/test-api';
import { unusedImportsRule } from '../../../../src/test-api';
import { applyFixes, createRuleContext, createSourceCode } from './rule-test-kit';
import { buildCommaTokens } from './token-utils';

interface Rng {
  nextU32(): number;
  int(min: number, maxInclusive: number): number;
  bool(pTrue: number): boolean;
  pick<T>(items: readonly T[]): T;
}

interface TwoStatementProgram {
  text: string;
  program: AstNode;
}

const mulberry32 = (seed: number): Rng => {
  let t = seed >>> 0;

  const nextU32 = (): number => {
    t += 0x6d2b79f5;

    const x1 = Math.imul(t ^ (t >>> 15), t | 1);
    const x2 = x1 ^ (x1 + Math.imul(x1 ^ (x1 >>> 7), x1 | 61));

    return (x2 ^ (x2 >>> 14)) >>> 0;
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

      const index = nextU32() % items.length;
      const item = items[index];

      if (item === undefined) {
        throw new Error('cannot pick from empty list');
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

const getRange = (node: AstNode | null | undefined): [number, number] | null => {
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

const buildImportCase = (rng: Rng) => {
  const importKind: 'type' | undefined = rng.bool(0.12) ? 'type' : undefined;
  const multiline = rng.bool(0.15);
  const specifierCount = rng.int(1, 4);
  const names: string[] = [];

  while (names.length < specifierCount) {
    const candidate = makeIdentifier(rng, 1, 8);

    if (!names.includes(candidate)) {
      names.push(candidate);
    }
  }

  const unused = new Set<string>();

  if (rng.bool(0.15)) {
    for (const name of names) {
      unused.add(name);
    }
  } else {
    const unusedCount = rng.int(1, Math.max(1, specifierCount));

    while (unused.size < unusedCount) {
      unused.add(rng.pick(names));
    }
  }

  const ws1 = whitespace(rng);
  const ws2 = whitespace(rng);
  const nl = newline(rng);
  let text = importKind === 'type' ? `import type{${ws1}` : `import{${ws1}`;
  const specifiers: AstNode[] = [];

  for (let i = 0; i < names.length; i += 1) {
    const name = names[i];
    const start = text.length;

    text += name;

    const end = text.length;

    specifiers.push({
      type: 'ImportSpecifier',
      range: [start, end],
      local: {
        type: 'Identifier',
        name: name ?? 'unknown',
        range: [start, end],
      },
    });

    if (i < names.length - 1) {
      text += multiline ? `,${nl}${ws2}` : `,${ws2}`;
    }
  }

  text += `${ws1}}from${ws1}'x';`;

  const variables: Variable[] = names.map(name => {
    const specifier = specifiers.find(spec => spec.local?.name === name);
    const range = getRange(specifier?.local ?? null);

    if (!range) {
      return { identifiers: [], references: [] } satisfies Variable;
    }

    return {
      identifiers: [{ type: 'Identifier', range }],
      references: unused.has(name) ? [] : [{ type: 'Identifier', range: [999, 1000] }],
    } satisfies Variable;
  });
  const node: AstNode = {
    type: 'ImportDeclaration',
    range: [0, text.length],
    specifiers,
  };

  if (importKind) {
    node.importKind = importKind;
  }

  return {
    text,
    node,
    variables,
    names,
    unused,
    importKind,
    multiline,
  };
};

const buildTwoStatementProgram = (
  stmtA: string,
  stmtB: string,
  between: string,
  prevNode: AstNode,
  nextNode: AstNode,
): TwoStatementProgram => {
  const text = `${stmtA}${between}${stmtB}`;
  const bStart = text.indexOf(stmtB);

  return {
    text,
    program: {
      type: 'Program',
      body: [
        { ...prevNode, range: [0, stmtA.length] },
        { ...nextNode, range: [bStart, bStart + stmtB.length] },
      ],
    },
  };
};

const runAutofixInvariantsFuzz = (): void => {
  const seeds = [1, 2, 3, 4, 5, 42, 1337, 9001];

  for (const seed of seeds) {
    const rng = mulberry32(seed);

    for (let i = 0; i < 200; i += 1) {
      const safe = rng.bool(0.7);
      const multi = rng.bool(0.2);
      const key = safe ? makeIdentifier(rng, 1, 8) : makeUnsafeKey(rng);
      const wsL = whitespace(rng);
      const wsR = whitespace(rng);
      const nl = newline(rng);
      const text = multi ? `obj[${nl}${wsL}'${key}'${wsR}${nl}]` : `obj[${wsL}'${key}'${wsR}]`;
      const propStart = text.indexOf("'");
      const propEnd = text.indexOf("'", propStart + 1) + 1;
      const sourceCode = createSourceCode(text, null, null, []);
      const { context, reports } = createRuleContext(sourceCode, []);
      const visitor = noBracketNotationRule.create(context);

      visitor.MemberExpression({
        type: 'MemberExpression',
        range: [0, text.length],
        object: { type: 'Identifier', name: 'obj', range: [0, 3] },
        property: { type: 'Literal', value: key, raw: `'${key}'`, range: [propStart, propEnd] },
        computed: true,
      });

      if (reports.length !== 1) {
        throw new Error('Expected one report for no-bracket-notation fuzz input.');
      }

      const fixed = applyFixes(text, reports);

      if (safe && !multi) {
        if (fixed !== `obj.${key}`) {
          throw new Error('Expected safe bracket notation fix to convert to dot form.');
        }

        const sourceCode2 = createSourceCode(fixed, null, null, []);
        const { context: context2, reports: reports2 } = createRuleContext(sourceCode2, []);
        const visitor2 = noBracketNotationRule.create(context2);

        visitor2.MemberExpression({
          type: 'MemberExpression',
          range: [0, fixed.length],
          object: { type: 'Identifier', name: 'obj', range: [0, 3] },
          property: { type: 'Identifier', name: key, range: [4, 4 + key.length] },
          computed: false,
        });

        if (reports2.length !== 0) {
          throw new Error('Expected no-bracket-notation to be idempotent after fix.');
        }
      } else if (fixed !== text) {
        throw new Error('Expected unsafe/multiline bracket notation to remain unchanged.');
      }
    }
  }

  const importSeeds = [11, 12, 13, 14, 15, 99, 1234];

  for (const seed of importSeeds) {
    const rng = mulberry32(seed);

    for (let i = 0; i < 250; i += 1) {
      const c = buildImportCase(rng);
      const tokens = buildCommaTokens(c.text);
      const sourceCode = createSourceCode(c.text, null, null, tokens);

      const getDeclaredVariables = () => c.variables;

      const { context, reports } = createRuleContext(sourceCode, [], getDeclaredVariables);
      const visitor = unusedImportsRule.create(context);

      visitor.ImportDeclaration(c.node);

      if (reports.length <= 0) {
        throw new Error('Expected unused-imports to report at least one violation.');
      }

      const fixed = applyFixes(c.text, reports);

      if (c.importKind === 'type') {
        if (fixed !== c.text) {
          throw new Error('Type-only imports must not be autofixed.');
        }
        continue;
      }

      if (c.multiline) {
        if (fixed !== c.text && fixed.trim().length !== 0) {
          throw new Error('Multiline specifier removal should be refused unless import is removed.');
        }
        continue;
      }

      if (fixed === c.text) {
        continue;
      }

      if (fixed.trim().length === 0) {
        continue;
      }

      const remainingNames = c.names.filter(name => fixed.includes(name));
      const variables2: Variable[] = remainingNames.map(name => {
        const start = fixed.indexOf(name);

        return {
          identifiers: [{ type: 'Identifier', range: [start, start + name.length] }],
          references: [{ type: 'Identifier', range: [2000, 2001] }],
        } satisfies Variable;
      });
      const tokens2 = buildCommaTokens(fixed);
      const sourceCode2 = createSourceCode(fixed, null, null, tokens2);

      const getDeclaredVariables2 = () => variables2;

      const { context: context2, reports: reports2 } = createRuleContext(sourceCode2, [], getDeclaredVariables2);
      const visitor2 = unusedImportsRule.create(context2);
      const specifiers2: AstNode[] = remainingNames.map(name => {
        const start = fixed.indexOf(name);
        const end = start + name.length;

        return {
          type: 'ImportSpecifier',
          range: [start, end],
          local: { type: 'Identifier', name, range: [start, end] },
        };
      });

      visitor2.ImportDeclaration({
        type: 'ImportDeclaration',
        range: [0, fixed.length],
        specifiers: specifiers2,
      });

      if (reports2.length !== 0) {
        throw new Error('Expected unused-imports to be idempotent after fix.');
      }
    }
  }

  const paddingSeeds = [21, 22, 23, 24, 25, 2026];

  for (const seed of paddingSeeds) {
    const rng = mulberry32(seed);

    for (let i = 0; i < 220; i += 1) {
      const nl = newline(rng);
      const mode = rng.pick(['const-const', 'const-fn'] as const);

      if (mode === 'const-const') {
        const a = makeIdentifier(rng, 3, 8);
        const b = makeIdentifier(rng, 3, 8);
        const stmtA = `const ${a} = 1;`;
        const stmtB = `const ${b} = 2;`;
        const hasBlank = rng.bool(0.6);
        const between = hasBlank ? `${nl}${nl}` : nl;
        const { text, program } = buildTwoStatementProgram(
          stmtA,
          stmtB,
          between,
          { type: 'VariableDeclaration', kind: 'const', declarations: [] },
          { type: 'VariableDeclaration', kind: 'const', declarations: [] },
        );
        const sourceCode = createSourceCode(text, null, null, []);
        const { context, reports } = createRuleContext(sourceCode, []);
        const visitor = paddingLineBetweenStatementsRule.create(context);

        visitor.Program(program);

        const fixed = applyFixes(text, reports);
        const bStart2 = fixed.indexOf(stmtB);
        const program2: AstNode = {
          type: 'Program',
          body: [
            { type: 'VariableDeclaration', kind: 'const', declarations: [], range: [0, stmtA.length] },
            { type: 'VariableDeclaration', kind: 'const', declarations: [], range: [bStart2, bStart2 + stmtB.length] },
          ],
        };
        const sourceCode2 = createSourceCode(fixed, null, null, []);
        const { context: context2, reports: reports2 } = createRuleContext(sourceCode2, []);
        const visitor2 = paddingLineBetweenStatementsRule.create(context2);

        visitor2.Program(program2);

        if (reports2.length !== 0) {
          throw new Error('Expected padding-line-between-statements to be idempotent for const/const.');
        }
      }

      if (mode === 'const-fn') {
        const a = makeIdentifier(rng, 3, 8);
        const f = makeIdentifier(rng, 3, 8);
        const stmtA = `const ${a} = 1;`;
        const stmtB = `function ${f}() {}`;
        const hasBlank = rng.bool(0.4);
        const between = hasBlank ? `${nl}${nl}` : nl;
        const { text, program } = buildTwoStatementProgram(
          stmtA,
          stmtB,
          between,
          { type: 'VariableDeclaration', kind: 'const', declarations: [] },
          { type: 'FunctionDeclaration' },
        );
        const sourceCode = createSourceCode(text, null, null, []);
        const { context, reports } = createRuleContext(sourceCode, []);
        const visitor = paddingLineBetweenStatementsRule.create(context);

        visitor.Program(program);

        const fixed = applyFixes(text, reports);
        const bStart2 = fixed.indexOf(stmtB);
        const program2: AstNode = {
          type: 'Program',
          body: [
            { type: 'VariableDeclaration', kind: 'const', declarations: [], range: [0, stmtA.length] },
            { type: 'FunctionDeclaration', range: [bStart2, bStart2 + stmtB.length] },
          ],
        };
        const sourceCode2 = createSourceCode(fixed, null, null, []);
        const { context: context2, reports: reports2 } = createRuleContext(sourceCode2, []);
        const visitor2 = paddingLineBetweenStatementsRule.create(context2);

        visitor2.Program(program2);

        if (reports2.length !== 0) {
          throw new Error('Expected padding-line-between-statements to be idempotent for const/function.');
        }
      }
    }
  }

  const blankLineSeeds = [31, 32, 33, 34, 35, 777];

  for (const seed of blankLineSeeds) {
    const rng = mulberry32(seed);

    for (let i = 0; i < 200; i += 1) {
      const nl = newline(rng);
      const fn = makeIdentifier(rng, 3, 8);
      const v = makeIdentifier(rng, 3, 8);
      const stmtA = `function ${fn}() {}`;
      const stmtB = `const ${v} = 1;`;
      const hasBlank = rng.bool(0.3);
      const between = hasBlank ? `${nl}${nl}` : nl;
      const { text, program } = buildTwoStatementProgram(
        stmtA,
        stmtB,
        between,
        { type: 'FunctionDeclaration' },
        { type: 'VariableDeclaration', kind: 'const', declarations: [] },
      );
      const sourceCode = createSourceCode(text, null, null, []);
      const { context, reports } = createRuleContext(sourceCode, []);
      const visitor = blankLinesBetweenStatementGroupsRule.create(context);

      visitor.Program(program);

      const fixed = applyFixes(text, reports);
      const bStart2 = fixed.indexOf(stmtB);
      const program2: AstNode = {
        type: 'Program',
        body: [
          { type: 'FunctionDeclaration', range: [0, stmtA.length] },
          { type: 'VariableDeclaration', kind: 'const', declarations: [], range: [bStart2, bStart2 + stmtB.length] },
        ],
      };
      const sourceCode2 = createSourceCode(fixed, null, null, []);
      const { context: context2, reports: reports2 } = createRuleContext(sourceCode2, []);
      const visitor2 = blankLinesBetweenStatementGroupsRule.create(context2);

      visitor2.Program(program2);

      if (reports2.length !== 0) {
        throw new Error('Expected blank-lines-between-statement-groups to be idempotent.');
      }
    }
  }
};

export { runAutofixInvariantsFuzz };
