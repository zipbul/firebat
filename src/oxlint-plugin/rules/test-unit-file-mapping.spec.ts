import { describe, expect, it } from 'bun:test';

import type { AstNode } from '../types';

import { setupRule, createProgram, expectReportCount } from '../../../test/integration/oxlint-plugin/utils/rule-test-kit';
import { createVirtualFs } from '../../../test/integration/oxlint-plugin/utils/virtual-fs';
import { testUnitFileMappingRule } from './test-unit-file-mapping';

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
    expectReportCount(visitor, 'Program', programNode, reports, 1);
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
    expectReportCount(visitor, 'Program', programNode, reports, 0);
  });

  it.each<[string, string, AstNode[]]>([
    ['extension is .test.ts', '/repo/user-service.test.ts', [{ type: 'ExpressionStatement' }]],
    ['extension is .e2e.test.ts', '/repo/user-service.e2e.test.ts', [{ type: 'ExpressionStatement' }]],
    ['name is index.ts', '/repo/index.ts', [{ type: 'ExportAllDeclaration' }]],
    ['extension is .d.ts', '/repo/user-service.d.ts', [{ type: 'TSInterfaceDeclaration' }]],
    [
      'only exports types',
      '/repo/types.ts',
      [{ type: 'ExportNamedDeclaration', declaration: { type: 'TSTypeAliasDeclaration' } }],
    ],
    ['module has only imports', '/repo/user-service.ts', [{ type: 'ImportDeclaration' }]],
    [
      'module only re-exports',
      '/repo/user-service.ts',
      [
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
      ],
    ],
  ])('should ignore file when %s', (_label, filename, body) => {
    // Arrange
    const programNode = createProgram(body);
    const { visitor, reports } = setupRule(testUnitFileMappingRule, {
      filename,
      fileExists: () => false,
      readFile: () => null,
    });

    // Act
    expectReportCount(visitor, 'Program', programNode, reports, 0);
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
    expectReportCount(visitor, 'Program', programNode, reports, 1);
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
    expectReportCount(visitor, 'Program', programNode, reports, 0);
  });
});
