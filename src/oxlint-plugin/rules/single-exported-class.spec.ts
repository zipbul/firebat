import { describe, expect, it } from 'bun:test';

import type { AstNode } from '../types';

import { setupRule } from '../../../test/integration/oxlint-plugin/utils/rule-test-kit';
import { singleExportedClassRule } from './single-exported-class';

function createProgram(body: AstNode[]): AstNode {
  return { type: 'Program', body };
}

const exportClass = (name: string): AstNode => ({
  type: 'ExportNamedDeclaration',
  declaration: { type: 'ClassDeclaration', id: { type: 'Identifier', name } },
});

const exportVariable: AstNode = {
  type: 'ExportNamedDeclaration',
  declaration: { type: 'VariableDeclaration' },
};

describe('single-exported-class', () => {
  it.each<[string, AstNode[]]>([
    ['a single exported class when only one is exported', [exportClass('UserService')]],
    ['files when no class is exported', [exportVariable]],
    [
      'class declaration when exported via specifier',
      [
        { type: 'ClassDeclaration', id: { type: 'Identifier', name: 'Foo' } },
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
  ])('should allow %s', (_label, body) => {
    // Arrange
    const { visitor, reports } = setupRule(singleExportedClassRule);
    const programNode = createProgram(body);

    // Act
    visitor.Program(programNode);

    // Assert
    expect(reports.length).toBe(0);
  });

  it.each<[string, AstNode[], string]>([
    ['exporting a class and another export', [exportClass('UserService'), exportVariable], 'mixed'],
    ['exporting two classes', [exportClass('A'), exportClass('B')], 'multiple'],
    [
      'exporting a class and an exported type',
      [exportClass('Foo'), { type: 'ExportNamedDeclaration', declaration: { type: 'TSTypeAliasDeclaration' } }],
      'mixed',
    ],
    [
      'default-exporting a class and also exporting something else',
      [
        { type: 'ExportDefaultDeclaration', declaration: { type: 'ClassDeclaration', id: { type: 'Identifier', name: 'Foo' } } },
        exportVariable,
      ],
      'mixed',
    ],
    ['exporting a class and also re-exporting everything', [exportClass('Foo'), { type: 'ExportAllDeclaration' }], 'mixed'],
  ])('should report when %s', (_label, body, messageId) => {
    // Arrange
    const { visitor, reports } = setupRule(singleExportedClassRule);
    const programNode = createProgram(body);

    // Act
    visitor.Program(programNode);

    // Assert
    expect(reports.length).toBe(1);
    expect(reports[0]?.messageId).toBe(messageId);
    expect(reports[0]?.node?.type).toBe('Program');
  });
});
