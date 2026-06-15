import { describe, expect, it } from 'bun:test';

import type { AstNode } from '../types';

import { setupRule } from '../../../test/integration/oxlint-plugin/utils/rule-test-kit';
import { createVirtualFs } from '../../../test/integration/oxlint-plugin/utils/virtual-fs';
import { testDescribeSutNameRule } from './test-describe-sut-name';

const testFile = '/repo/user-service.spec.ts';
const implFile = '/repo/user-service.ts';

function createTopLevelDescribeCall(title: string): [AstNode, AstNode] {
  const program: AstNode = { type: 'Program', body: [] };
  const expressionStatement: AstNode = { type: 'ExpressionStatement', parent: program };
  const call: AstNode = {
    type: 'CallExpression',
    callee: { type: 'Identifier', name: 'describe' },
    arguments: [
      { type: 'Literal', value: title },
      { type: 'ArrowFunctionExpression', body: { type: 'BlockStatement' } },
    ],
    parent: expressionStatement,
  };

  // Link the statement to satisfy top-level detection.
  program.body = [expressionStatement];
  expressionStatement.expression = call;

  return [program, call];
}

/** Build a rule wired to a virtual FS that backs implFile with the given source. */
function setupWithImpl(implSource: string) {
  const virtualFs = createVirtualFs([[implFile, implSource]]);

  return setupRule(testDescribeSutNameRule, {
    filename: testFile,
    fileExists: filePath => virtualFs.fileExists(filePath),
    readFile: filePath => virtualFs.readFile(filePath),
  });
}

describe('test-describe-sut-name', () => {
  it.each<[string, string, string]>([
    ['implementation exports a class', 'export class UserService {}\n', 'UserService'],
    ['implementation does not export a class', 'export function createUser() {}\n', 'user-service'],
    ['implementation exports multiple classes', 'export class A {}\nexport class B {}\n', 'user-service'],
  ])('should accept describe title when %s', (_label, implSource, title) => {
    // Arrange
    const { visitor, reports } = setupWithImpl(implSource);
    const [, call] = createTopLevelDescribeCall(title);

    // Act
    visitor.CallExpression(call);

    // Assert
    expect(reports.length).toBe(0);
  });

  it('should ignore when file is not a unit spec', () => {
    // Arrange
    const { visitor, reports } = setupRule(testDescribeSutNameRule, {
      filename: '/repo/user-service.test.ts',
      fileExists: () => false,
      readFile: () => null,
    });
    const [, call] = createTopLevelDescribeCall('UserService');

    // Act
    visitor.CallExpression(call);

    // Assert
    expect(reports.length).toBe(0);
  });

  it('should report when describe title does not match expected SUT', () => {
    // Arrange
    const { visitor, reports } = setupWithImpl('export class UserService {}\n');
    const [, call] = createTopLevelDescribeCall('user-service');

    // Act
    visitor.CallExpression(call);

    // Assert
    expect(reports.length).toBe(1);
    expect(reports[0]?.messageId).toBe('sutName');
    expect(reports[0]?.data?.expected).toBe('UserService');
  });

  it('should fall back to filename when implementation file is missing', () => {
    // Arrange
    const { visitor, reports } = setupRule(testDescribeSutNameRule, {
      filename: testFile,
      fileExists: () => false,
      readFile: () => null,
    });
    const [, call] = createTopLevelDescribeCall('UserService');

    // Act
    visitor.CallExpression(call);

    // Assert
    expect(reports.length).toBe(1);
    expect(reports[0]?.messageId).toBe('sutName');
    expect(reports[0]?.data?.expected).toBe('user-service');
  });

  it('should report when any top-level describe title mismatches', () => {
    // Arrange
    const { visitor, reports } = setupWithImpl('export class UserService {}\n');
    const first = createTopLevelDescribeCall('UserService')[1];
    const second = createTopLevelDescribeCall('Other')[1];

    // Act
    visitor.CallExpression(first);
    visitor.CallExpression(second);

    // Assert
    expect(reports.length).toBe(1);
    expect(reports[0]?.messageId).toBe('sutName');
    expect(reports[0]?.data?.expected).toBe('UserService');
  });

  it('should ignore nested describe calls when not top-level', () => {
    // Arrange
    const { visitor, reports } = setupWithImpl('export class UserService {}\n');
    // Describe call whose parent is not Program → should be ignored.
    const call: AstNode = {
      type: 'CallExpression',
      callee: { type: 'Identifier', name: 'describe' },
      arguments: [
        { type: 'Literal', value: 'UserService' },
        { type: 'ArrowFunctionExpression', body: { type: 'BlockStatement' } },
      ],
      parent: { type: 'CallExpression' },
    };

    // Act
    visitor.CallExpression(call);

    // Assert
    expect(reports.length).toBe(0);
  });
});
