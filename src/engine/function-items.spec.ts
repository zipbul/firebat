import { describe, it, expect } from 'bun:test';

import { parseSource } from './parse-source';
import { collectFunctionItems } from './function-items';

const file = (sourceText: string) => parseSource('test.ts', sourceText);

describe('collectFunctionItems', () => {
  it('[ED] returns [] for empty files array', () => {
    const result = collectFunctionItems([], () => 'item');
    expect(result).toEqual([]);
  });

  it('[ED] skips files with parse errors', () => {
    const called = { count: 0 };
    collectFunctionItems([file('const = ;')], () => {
      called.count++;
      return null;
    });
    expect(called.count).toBe(0);
  });

  it('[HP] calls analyzer for each function node', () => {
    const called: string[] = [];
    collectFunctionItems([file('function a() {} function b() {}')], (node) => {
      called.push(node.type);
      return node.type;
    });
    expect(called.length).toBeGreaterThan(0);
  });

  it('[HP] collects returned items from analyzer', () => {
    const result = collectFunctionItems(
      [file('function f() { return 1; }')],
      (_node, filePath) => filePath,
    );
    expect(result).toContain('test.ts');
  });

  it('[NE] skips items returned as null by analyzer', () => {
    const result = collectFunctionItems(
      [file('function f() {}')],
      () => null,
    );
    expect(result).toEqual([]);
  });

  it('[NE] skips items returned as undefined by analyzer', () => {
    const result = collectFunctionItems(
      [file('function f() {}')],
      () => undefined as unknown as null,
    );
    expect(result).toEqual([]);
  });
});
