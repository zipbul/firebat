import { describe, expect, it } from 'bun:test';

import type { NodeValue, VariableUsage } from '../types';

import { isOxcNode, isOxcNodeArray } from '../ast/oxc-ast-utils';
import { parseSource } from '../ast/parse-source';
import { collectVariables } from './variable-collector';

const getFunctionBodyStatement = (sourceText: string, statementIndex: number): NodeValue => {
  const parsed = parseSource('/virtual/variable-collector.spec.ts', sourceText);
  const program = parsed.program;

  if (!isOxcNode(program)) {
    throw new Error('Expected program node');
  }

  const body = program.body;

  if (!isOxcNodeArray(body) || body.length === 0) {
    throw new Error('Expected program body array');
  }

  const functionDecl = body[0];

  if (!isOxcNode(functionDecl)) {
    throw new Error('Expected function decl node');
  }

  const functionBody = isOxcNode(functionDecl) && 'body' in functionDecl ? functionDecl.body : undefined;

  if (!isOxcNode(functionBody)) {
    throw new Error('Expected function body');
  }

  const statements = isOxcNode(functionBody) && 'body' in functionBody ? functionBody.body : undefined;

  if (!isOxcNodeArray(statements) || statements.length === 0) {
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
  it('should not count reads when a statically never-executed && branch exists', () => {
    // Arrange
    const statement = getFunctionBodyStatement(['function f() {', '  let value = 1;', '  false && value;', '}'].join('\n'), 1);
    // Act
    const usages = collectVariables(statement, { includeNestedFunctions: false });
    const valueReads = getReadCount(usages, 'value');

    // Assert
    expect(valueReads).toBe(0);
  });

  it('should not count reads when a conditional branch is statically unreachable', () => {
    // Arrange
    const statement = getFunctionBodyStatement(['function f() {', '  let value = 1;', '  true ? 0 : value;', '}'].join('\n'), 1);
    // Act
    const usages = collectVariables(statement, { includeNestedFunctions: false });
    const valueReads = getReadCount(usages, 'value');

    // Assert
    expect(valueReads).toBe(0);
  });

  it('should count reads when inside an immediately-invoked function expression', () => {
    // Arrange
    const statement = getFunctionBodyStatement(['function f() {', '  let value = 1;', '  (() => value)();', '}'].join('\n'), 1);
    // Act
    const usages = collectVariables(statement, { includeNestedFunctions: false });
    const valueReads = getReadCount(usages, 'value');

    // Assert
    expect(valueReads).toBeGreaterThan(0);
  });

  it('should not count destructuring default reads when the property is statically present', () => {
    // Arrange
    const statement = getFunctionBodyStatement(
      ['function f() {', '  let value = 1;', '  let { a = value } = { a: 2 };', '}'].join('\n'),
      1,
    );
    // Act
    const usages = collectVariables(statement, { includeNestedFunctions: false });
    const valueReads = getReadCount(usages, 'value');

    // Assert
    expect(valueReads).toBe(0);
  });

  it('should count destructuring default reads when the property is statically missing', () => {
    // Arrange
    const statement = getFunctionBodyStatement(
      ['function f() {', '  let value = 1;', '  let { a = value } = {};', '}'].join('\n'),
      1,
    );
    // Act
    const usages = collectVariables(statement, { includeNestedFunctions: false });
    const valueReads = getReadCount(usages, 'value');

    // Assert
    expect(valueReads).toBeGreaterThan(0);
  });
});
