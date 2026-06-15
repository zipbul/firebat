import { describe, expect, it } from 'bun:test';

import type { AstNode } from '../types';

import { setupRule } from '../../../test/integration/oxlint-plugin/utils/rule-test-kit';
import { noGlobalThisMutationRule } from './no-globalthis-mutation';

const globalThisMember = (property: string): AstNode => ({
  type: 'MemberExpression',
  object: { type: 'Identifier', name: 'globalThis' },
  property: { type: 'Identifier', name: property },
});

const objectCall = (method: string): AstNode => ({
  type: 'CallExpression',
  callee: {
    type: 'MemberExpression',
    object: { type: 'Identifier', name: 'Object' },
    property: { type: 'Identifier', name: method },
    computed: false,
  },
  arguments: [{ type: 'Identifier', name: 'globalThis' }],
});

type Visit = 'AssignmentExpression' | 'UpdateExpression' | 'CallExpression' | 'UnaryExpression';

describe('no-globalthis-mutation', () => {
  it.each<[string, Visit, AstNode]>([
    ['globalThis members are mutated', 'AssignmentExpression', { type: 'AssignmentExpression', left: globalThisMember('value') }],
    [
      'update expressions target globalThis members',
      'UpdateExpression',
      { type: 'UpdateExpression', argument: globalThisMember('count') },
    ],
    ['Object.assign targets globalThis', 'CallExpression', objectCall('assign')],
    ['Object.defineProperty targets globalThis', 'CallExpression', objectCall('defineProperty')],
    [
      'delete usage targets globalThis member',
      'UnaryExpression',
      { type: 'UnaryExpression', operator: 'delete', argument: globalThisMember('prop') },
    ],
    [
      'nested globalThis assignments occur',
      'AssignmentExpression',
      {
        type: 'AssignmentExpression',
        // globalThis.prop.sub = 1 -> left is MemberExpression(MemberExpression(globalThis.prop), sub)
        left: {
          type: 'MemberExpression',
          object: globalThisMember('prop'),
          property: { type: 'Identifier', name: 'sub' },
        },
      },
    ],
  ])('should report when %s', (_label, method, node) => {
    // Arrange
    const { visitor, reports } = setupRule(noGlobalThisMutationRule);

    // Act
    visitor[method](node);

    // Assert
    expect(reports.length).toBe(1);
    expect(reports[0]?.messageId).toBe('globalThisMutation');
  });
});
