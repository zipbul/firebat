import { describe, expect, it } from 'bun:test';

import type { AstNode } from '../types';

import { setupRule } from '../../../test/integration/oxlint-plugin/utils/rule-test-kit';
import { createVirtualFs } from '../../../test/integration/oxlint-plugin/utils/virtual-fs';
import { testUnitFileMappingRule } from './test-unit-file-mapping';

function createProgram(body: AstNode[]): AstNode {
  return { type: 'Program', body };
}

describe('test-unit-file-mapping', () => {
  it('should report missing spec when implementation is logicful', () => {
    // Arrange
    const implFile = '/repo/user-service.ts';
    const specFile = '/repo/user-service.spec.ts';
    const virtualFs = createVirtualFs([[implFile, 'export function run() {}']]);
    const programNode = createProgram([{ type: 'FunctionDeclaration' }]);
    const { visitor, reports } = setupRule(testUnitFileMappingRule, {
      filename: implFile,
      fileExists: filePath => virtualFs.fileExists(filePath),
      readFile: filePath => virtualFs.readFile(filePath),
    });

    // Act
    visitor.Program(programNode);

    // Assert
    expect(reports.length).toBe(1);
    expect(reports[0]?.messageId).toBe('missingSpec');
    expect(reports[0]?.data?.expected).toBe(specFile);
  });

  it('should skip report when spec exists for logicful implementation', () => {
    // Arrange
    const implFile = '/repo/user-service.ts';
    const specFile = '/repo/user-service.spec.ts';
    const virtualFs = createVirtualFs([
      [implFile, 'export function run() {}'],
      [specFile, "describe('UserService', () => {})"],
    ]);
    const programNode = createProgram([{ type: 'FunctionDeclaration' }]);
    const { visitor, reports } = setupRule(testUnitFileMappingRule, {
      filename: implFile,
      fileExists: filePath => virtualFs.fileExists(filePath),
      readFile: filePath => virtualFs.readFile(filePath),
    });

    // Act
    visitor.Program(programNode);

    // Assert
    expect(reports.length).toBe(0);
  });

  it('should ignore file when extension is .test.ts', () => {
    // Arrange
    const implFile = '/repo/user-service.test.ts';
    const programNode = createProgram([{ type: 'ExpressionStatement' }]);
    const { visitor, reports } = setupRule(testUnitFileMappingRule, {
      filename: implFile,
      fileExists: () => false,
      readFile: () => null,
    });

    // Act
    visitor.Program(programNode);

    // Assert
    expect(reports.length).toBe(0);
  });

  it('should ignore file when extension is .e2e.test.ts', () => {
    // Arrange
    const implFile = '/repo/user-service.e2e.test.ts';
    const programNode = createProgram([{ type: 'ExpressionStatement' }]);
    const { visitor, reports } = setupRule(testUnitFileMappingRule, {
      filename: implFile,
      fileExists: () => false,
      readFile: () => null,
    });

    // Act
    visitor.Program(programNode);

    // Assert
    expect(reports.length).toBe(0);
  });

  it('should ignore file when name is index.ts', () => {
    // Arrange
    const implFile = '/repo/index.ts';
    const programNode = createProgram([{ type: 'ExportAllDeclaration' }]);
    const { visitor, reports } = setupRule(testUnitFileMappingRule, {
      filename: implFile,
      fileExists: () => false,
      readFile: () => null,
    });

    // Act
    visitor.Program(programNode);

    // Assert
    expect(reports.length).toBe(0);
  });

  it('should ignore file when extension is .d.ts', () => {
    // Arrange
    const implFile = '/repo/user-service.d.ts';
    const programNode = createProgram([{ type: 'TSInterfaceDeclaration' }]);
    const { visitor, reports } = setupRule(testUnitFileMappingRule, {
      filename: implFile,
      fileExists: () => false,
      readFile: () => null,
    });

    // Act
    visitor.Program(programNode);

    // Assert
    expect(reports.length).toBe(0);
  });

  it('should ignore file when only exports types', () => {
    // Arrange
    const implFile = '/repo/types.ts';
    const programNode = createProgram([
      {
        type: 'ExportNamedDeclaration',
        declaration: {
          type: 'TSTypeAliasDeclaration',
        },
      },
    ]);
    const { visitor, reports } = setupRule(testUnitFileMappingRule, {
      filename: implFile,
      fileExists: () => false,
      readFile: () => null,
    });

    // Act
    visitor.Program(programNode);

    // Assert
    expect(reports.length).toBe(0);
  });

  it('should ignore file when module has only imports', () => {
    // Arrange
    const implFile = '/repo/user-service.ts';
    const programNode = createProgram([{ type: 'ImportDeclaration' }]);
    const { visitor, reports } = setupRule(testUnitFileMappingRule, {
      filename: implFile,
      fileExists: () => false,
      readFile: () => null,
    });

    // Act
    visitor.Program(programNode);

    // Assert
    expect(reports.length).toBe(0);
  });

  it('should ignore file when module only re-exports', () => {
    // Arrange
    const implFile = '/repo/user-service.ts';
    const programNode = createProgram([
      {
        type: 'ExportNamedDeclaration',
        specifiers: [
          {
            type: 'ExportSpecifier',
            local: { type: 'Identifier', name: 'Foo' },
            exported: { type: 'Identifier', name: 'Foo' },
          },
        ],
      },
    ]);
    const { visitor, reports } = setupRule(testUnitFileMappingRule, {
      filename: implFile,
      fileExists: () => false,
      readFile: () => null,
    });

    // Act
    visitor.Program(programNode);

    // Assert
    expect(reports.length).toBe(0);
  });

  it('should report missing implementation when spec exists', () => {
    // Arrange
    const specFile = '/repo/user-service.spec.ts';
    const implFile = '/repo/user-service.ts';
    const virtualFs = createVirtualFs([[specFile, "describe('UserService', () => {})"]]);
    const programNode = createProgram([{ type: 'ExpressionStatement' }]);
    const { visitor, reports } = setupRule(testUnitFileMappingRule, {
      filename: specFile,
      fileExists: filePath => virtualFs.fileExists(filePath),
      readFile: filePath => virtualFs.readFile(filePath),
    });

    // Act
    visitor.Program(programNode);

    // Assert
    expect(reports.length).toBe(1);
    expect(reports[0]?.messageId).toBe('missingImplementation');
    expect(reports[0]?.data?.expected).toBe(implFile);
  });

  it('should skip report when implementation exists for spec', () => {
    // Arrange
    const specFile = '/repo/user-service.spec.ts';
    const implFile = '/repo/user-service.ts';
    const virtualFs = createVirtualFs([
      [specFile, "describe('UserService', () => {})"],
      [implFile, 'export class UserService {}'],
    ]);
    const programNode = createProgram([{ type: 'ExpressionStatement' }]);
    const { visitor, reports } = setupRule(testUnitFileMappingRule, {
      filename: specFile,
      fileExists: filePath => virtualFs.fileExists(filePath),
      readFile: filePath => virtualFs.readFile(filePath),
    });

    // Act
    visitor.Program(programNode);

    // Assert
    expect(reports.length).toBe(0);
  });
});
