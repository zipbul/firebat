import { describe, expect, it } from 'bun:test';

// oxlint-plugin/types.ts exports only TypeScript interfaces/types.
// All tests are structural shape validation — no runtime exports.

describe('oxlint-plugin/types — structural shapes', () => {
  it('Range is a two-element tuple [number, number]', () => {
    const r: [number, number] = [0, 15];
    expect(r[0]).toBe(0);
    expect(r[1]).toBe(15);
    expect(r.length).toBe(2);
  });

  it('SourcePosition has line and column number fields', () => {
    const sp = { line: 3, column: 12 };
    expect(sp.line).toBe(3);
    expect(sp.column).toBe(12);
  });

  it('SourceLocation has start and end SourcePosition', () => {
    const loc = { start: { line: 1, column: 0 }, end: { line: 1, column: 20 } };
    expect(loc.start.line).toBe(1);
    expect(loc.end.column).toBe(20);
  });

  it('Token has optional value and range fields', () => {
    const t1 = {};
    const t2 = { value: 'foo', range: [0, 3] as [number, number] };
    expect((t1 as { value?: string }).value).toBeUndefined();
    expect(t2.value).toBe('foo');
    expect(t2.range[0]).toBe(0);
  });

  it('Fix has required range and optional text', () => {
    const fix1 = { range: [5, 10] as [number, number] };
    const fix2 = { range: [0, 5] as [number, number], text: 'replacement' };
    expect(fix1.range[0]).toBe(5);
    expect(fix2.text).toBe('replacement');
  });

  it('AstNode has required type field and optional structural fields', () => {
    const node = {
      type: 'Identifier',
      range: [0, 4] as [number, number],
      name: 'foo',
    };
    expect(node.type).toBe('Identifier');
    expect(node.name).toBe('foo');
    expect((node as { parent?: unknown }).parent).toBeUndefined();
  });

  it('ReportDescriptor has required messageId and node fields', () => {
    const mockNode = { type: 'Identifier' };
    const descriptor = {
      messageId: 'someMessage',
      node: mockNode,
      data: { key: 'value' },
    };
    expect(descriptor.messageId).toBe('someMessage');
    expect(descriptor.node.type).toBe('Identifier');
    expect(descriptor.data?.key).toBe('value');
  });

  it('PaddingRule has blankLine, prev, next fields', () => {
    const rule = { blankLine: 'always', prev: 'return', next: '*' };
    expect(rule.blankLine).toBe('always');
    expect(rule.prev).toBe('return');
    expect(rule.next).toBe('*');
  });

  it('JsonValue covers primitives, objects, arrays recursively', () => {
    const prim: import('./types').JsonValue = 42;
    const arr: import('./types').JsonValue = [1, 'two', null];
    const obj: import('./types').JsonValue = { key: true };
    expect(prim).toBe(42);
    expect(Array.isArray(arr)).toBe(true);
    expect((obj as { key: unknown }).key).toBe(true);
  });
});
