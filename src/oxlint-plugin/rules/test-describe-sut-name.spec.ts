import { describe, expect, it } from 'bun:test';

import type { AstNode } from '../types';

import { setupRule } from '../../../test/integration/oxlint-plugin/utils/rule-test-kit';
import { createVirtualFs } from '../../../test/integration/oxlint-plugin/utils/virtual-fs';
import { testDescribeSutNameRule } from './test-describe-sut-name';

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

describe('test-describe-sut-name', () => {
  it('should require class name when implementation exports a class', () => {
    // Arrange
    const testFile = '/repo/user-service.spec.ts';
    const implFile = '/repo/user-service.ts';
    const virtualFs = createVirtualFs([[implFile, 'export class UserService {}\n']]);
    const { visitor, reports } = setupRule(testDescribeSutNameRule, {
      filename: testFile,
      fileExists: filePath => virtualFs.fileExists(filePath),
      readFile: filePath => virtualFs.readFile(filePath),
    });
    const [, call] = createTopLevelDescribeCall('UserService');

    // Act
    visitor.CallExpression(call);

    // Assert
    expect(reports.length).toBe(0);
  });

  it('should ignore when file is not a unit spec', () => {
    // Arrange
    const testFile = '/repo/user-service.test.ts';
    const { visitor, reports } = setupRule(testDescribeSutNameRule, {
      filename: testFile,
      fileExists: () => false,
      readFile: () => null,
    });
    const [, call] = createTopLevelDescribeCall('UserService');

    // Act
    visitor.CallExpression(call);

    // Assert
    expect(reports.length).toBe(0);
  });

  it('should fall back to filename when implementation does not export a class', () => {
    // Arrange
    const testFile = '/repo/user-service.spec.ts';
    const implFile = '/repo/user-service.ts';
    const virtualFs = createVirtualFs([[implFile, 'export function createUser() {}\n']]);
    const { visitor, reports } = setupRule(testDescribeSutNameRule, {
      filename: testFile,
      fileExists: filePath => virtualFs.fileExists(filePath),
      readFile: filePath => virtualFs.readFile(filePath),
    });
    const [, call] = createTopLevelDescribeCall('user-service');

    // Act
    visitor.CallExpression(call);

    // Assert
    expect(reports.length).toBe(0);
  });

  it('should fall back to filename when implementation exports multiple classes', () => {
    // Arrange
    const testFile = '/repo/user-service.spec.ts';
    const implFile = '/repo/user-service.ts';
    const virtualFs = createVirtualFs([[implFile, 'export class A {}\nexport class B {}\n']]);
    const { visitor, reports } = setupRule(testDescribeSutNameRule, {
      filename: testFile,
      fileExists: filePath => virtualFs.fileExists(filePath),
      readFile: filePath => virtualFs.readFile(filePath),
    });
    const [, call] = createTopLevelDescribeCall('user-service');

    // Act
    visitor.CallExpression(call);

    // Assert
    expect(reports.length).toBe(0);
  });

  it('should report when describe title does not match expected SUT', () => {
    // Arrange
    const testFile = '/repo/user-service.spec.ts';
    const implFile = '/repo/user-service.ts';
    const virtualFs = createVirtualFs([[implFile, 'export class UserService {}\n']]);
    const { visitor, reports } = setupRule(testDescribeSutNameRule, {
      filename: testFile,
      fileExists: filePath => virtualFs.fileExists(filePath),
      readFile: filePath => virtualFs.readFile(filePath),
    });
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
    const testFile = '/repo/user-service.spec.ts';
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
    const testFile = '/repo/user-service.spec.ts';
    const implFile = '/repo/user-service.ts';
    const virtualFs = createVirtualFs([[implFile, 'export class UserService {}\n']]);
    const { visitor, reports } = setupRule(testDescribeSutNameRule, {
      filename: testFile,
      fileExists: filePath => virtualFs.fileExists(filePath),
      readFile: filePath => virtualFs.readFile(filePath),
    });
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
    const testFile = '/repo/user-service.spec.ts';
    const implFile = '/repo/user-service.ts';
    const virtualFs = createVirtualFs([[implFile, 'export class UserService {}\n']]);
    const { visitor, reports } = setupRule(testDescribeSutNameRule, {
      filename: testFile,
      fileExists: filePath => virtualFs.fileExists(filePath),
      readFile: filePath => virtualFs.readFile(filePath),
    });
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
