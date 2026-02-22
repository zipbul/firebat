import { mock, afterAll, describe, it, expect, beforeEach } from 'bun:test';
import path from 'node:path';
import type { DuplicateGroup } from '../types';

const collectDuplicateGroupsMock = mock(
  (..._args: unknown[]): DuplicateGroup[] => [],
);

const __origDuplicateCollector = { ...require(path.resolve(import.meta.dir, './duplicate-collector.ts')) };

mock.module(path.resolve(import.meta.dir, './duplicate-collector.ts'), () => ({
  collectDuplicateGroups: collectDuplicateGroupsMock,
}));

const { detectClones, isCloneTarget } = await import('./duplicate-detector');

describe('isCloneTarget', () => {
  const targetTypes = [
    'FunctionDeclaration',
    'ClassDeclaration',
    'ClassExpression',
    'MethodDefinition',
    'FunctionExpression',
    'ArrowFunctionExpression',
    'TSTypeAliasDeclaration',
    'TSInterfaceDeclaration',
  ];

  for (const nodeType of targetTypes) {
    it(`returns true for ${nodeType}`, () => {
      expect(isCloneTarget({ type: nodeType, start: 0, end: 1 } as never)).toBe(true);
    });
  }

  it('returns false for non-clone-target node types', () => {
    expect(isCloneTarget({ type: 'ExpressionStatement', start: 0, end: 1 } as never)).toBe(false);
    expect(isCloneTarget({ type: 'IfStatement', start: 0, end: 1 } as never)).toBe(false);
  });
});

describe('detectClones', () => {
  beforeEach(() => {
    collectDuplicateGroupsMock.mockReset();
    collectDuplicateGroupsMock.mockImplementation(() => []);
  });

  it('[HP] calls collectDuplicateGroups and returns its result', () => {
    const group = { cloneType: 'type-1', items: [] } as unknown as DuplicateGroup;
    collectDuplicateGroupsMock.mockImplementation(() => [group]);
    const result = detectClones([], 10, 'type-1');
    expect(result).toEqual([group]);
  });

  it('[HP] passes cloneType=type-1 → uses exact fingerprint', () => {
    detectClones([], 10, 'type-1');
    expect(collectDuplicateGroupsMock).toHaveBeenCalledTimes(1);
    const args = collectDuplicateGroupsMock.mock.calls[0];
    // arg[4] is getItemKind, arg[5] is cloneType
    expect(args?.[5]).toBe('type-1');
  });

  it('[HP] passes cloneType=type-2-shape', () => {
    detectClones([], 10, 'type-2-shape');
    expect(collectDuplicateGroupsMock.mock.calls[0]?.[5]).toBe('type-2-shape');
  });

  it('[HP] passes cloneType=type-3-normalized', () => {
    detectClones([], 10, 'type-3-normalized');
    expect(collectDuplicateGroupsMock.mock.calls[0]?.[5]).toBe('type-3-normalized');
  });

  it('[ED] returns [] when collectDuplicateGroups returns []', () => {
    expect(detectClones([], 10, 'type-1')).toEqual([]);
  });
});

afterAll(() => {
  mock.restore();
  mock.module(path.resolve(import.meta.dir, './duplicate-collector.ts'), () => __origDuplicateCollector);
});
