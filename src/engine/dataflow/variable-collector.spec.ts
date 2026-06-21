import type { Node } from 'oxc-parser';

import { describe, expect, it } from 'bun:test';

import type { VariableUsage } from '../types';

import { isOxcNode } from '../ast/oxc-ast-utils';
import { parseSource } from '../ast/parse-source';
import { collectVariables } from './variable-collector';

interface ReadCountCase {
  name: string;
  lines: string[];
  statementIndex: number;
}

const getFunctionBodyStatement = (sourceText: string, statementIndex: number): Node => {
  const parsed = parseSource('/virtual/variable-collector.spec.ts', sourceText);
  const program = parsed.program;
  const body = Array.isArray(program.body) ? (program.body as ReadonlyArray<Node>) : [];

  if (body.length === 0) {
    throw new Error('Expected program body array');
  }

  const functionDecl = body[0];

  if (functionDecl === undefined) {
    throw new Error('Expected function decl node');
  }

  const functionBody = 'body' in functionDecl ? (functionDecl.body as Node | undefined) : undefined;

  if (!isOxcNode(functionBody)) {
    throw new Error('Expected function body');
  }

  const functionBodyRecord = functionBody as unknown as Record<string, unknown>;
  const statements = Array.isArray(functionBodyRecord.body) ? (functionBodyRecord.body as ReadonlyArray<Node>) : [];

  if (statements.length === 0) {
    throw new Error('Expected function body statements');
  }

  const picked = statements[statementIndex];

  if (picked === undefined) {
    throw new Error('Expected statement at index');
  }

  return picked;
};

const getReadCount = (usages: ReadonlyArray<VariableUsage>, name: string): number => {
  return usages.filter(usage => usage.name === name && usage.isRead).length;
};

describe('variable-collector', () => {
  // Rows where the static-analysis path proves `value` is never read → read count 0.
  const zeroReadCases: ReadCountCase[] = [
    {
      name: 'should not count reads when a statically never-executed && branch exists',
      lines: ['function f() {', '  let value = 1;', '  false && value;', '}'],
      statementIndex: 1,
    },
    {
      name: 'should not count reads when a conditional branch is statically unreachable',
      lines: ['function f() {', '  let value = 1;', '  true ? 0 : value;', '}'],
      statementIndex: 1,
    },
    {
      name: 'should not count destructuring default reads when the property is statically present',
      lines: ['function f() {', '  let value = 1;', '  let { a = value } = { a: 2 };', '}'],
      statementIndex: 1,
    },
  ];

  it.each(zeroReadCases)('$name', ({ lines, statementIndex }) => {
    const statement = getFunctionBodyStatement(lines.join('\n'), statementIndex);
    const usages = collectVariables(statement, { includeNestedFunctions: false });
    const valueReads = getReadCount(usages, 'value');

    expect(valueReads).toBe(0);
  });

  // Rows where `value` is genuinely reachable → at least one read counted.
  const positiveReadCases: ReadCountCase[] = [
    {
      name: 'should count reads when inside an immediately-invoked function expression',
      lines: ['function f() {', '  let value = 1;', '  (() => value)();', '}'],
      statementIndex: 1,
    },
    {
      name: 'should count destructuring default reads when the property is statically missing',
      lines: ['function f() {', '  let value = 1;', '  let { a = value } = {};', '}'],
      statementIndex: 1,
    },
  ];

  it.each(positiveReadCases)('$name', ({ lines, statementIndex }) => {
    const statement = getFunctionBodyStatement(lines.join('\n'), statementIndex);
    const usages = collectVariables(statement, { includeNestedFunctions: false });
    const valueReads = getReadCount(usages, 'value');

    expect(valueReads).toBeGreaterThan(0);
  });

  it('collectVariables - object rest element with static object literal - should track rest variable as declaration write', () => {
    // Arrange
    // const { a, ...rest } = { a: 1, b: 2, c: 3 };
    const statement = getFunctionBodyStatement(
      ['function f() {', '  const { a, ...rest } = { a: 1, b: 2, c: 3 };', '}'].join('\n'),
      0,
    );
    // Act
    const usages = collectVariables(statement, { includeNestedFunctions: false });
    const restWrites = usages.filter(u => u.name === 'rest' && u.isWrite && u.writeKind === 'declaration');

    // Assert
    expect(restWrites.length).toBeGreaterThan(0);
  });
});
