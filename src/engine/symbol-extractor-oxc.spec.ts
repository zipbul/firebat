import { describe, it, expect } from 'bun:test';

import { parseSource } from './ast/parse-source';
import { extractSymbolsOxc } from './symbol-extractor-oxc';

const file = (src: string) => parseSource('test.ts', src);

describe('extractSymbolsOxc', () => {
  it('[ED] returns [] for an empty file', () => {
    expect(extractSymbolsOxc(file(''))).toEqual([]);
  });

  it('[HP] extracts a named function declaration', () => {
    const symbols = extractSymbolsOxc(file('function myFunc() {}'));
    expect(symbols).toHaveLength(1);
    expect(symbols[0]).toMatchObject({ kind: 'function', name: 'myFunc', isExported: false });
  });

  it('[HP] marks exported function as isExported=true', () => {
    const symbols = extractSymbolsOxc(file('export function exported() {}'));
    const fn = symbols.find(s => s.name === 'exported');
    expect(fn?.isExported).toBe(true);
  });

  it('[HP] extracts arrow function assigned to const', () => {
    const symbols = extractSymbolsOxc(file('const arrow = () => {};'));
    expect(symbols.some(s => s.name === 'arrow' && s.kind === 'function')).toBe(true);
  });

  it('[HP] extracts class declaration', () => {
    const symbols = extractSymbolsOxc(file('class MyClass {}'));
    expect(symbols.some(s => s.name === 'MyClass' && s.kind === 'class')).toBe(true);
  });

  it('[HP] extracts class method', () => {
    const symbols = extractSymbolsOxc(file('class C { doThing() {} }'));
    expect(symbols.some(s => s.name === 'doThing' && s.kind === 'method')).toBe(true);
  });

  it('[HP] marks class method isExported=false always', () => {
    const symbols = extractSymbolsOxc(file('export class C { doThing() {} }'));
    const method = symbols.find(s => s.kind === 'method');
    expect(method?.isExported).toBe(false);
  });

  it('[HP] extracts TS type alias', () => {
    const symbols = extractSymbolsOxc(file('type MyType = { x: number };'));
    expect(symbols.some(s => s.name === 'MyType' && s.kind === 'type')).toBe(true);
  });

  it('[HP] extracts TS interface declaration', () => {
    const symbols = extractSymbolsOxc(file('interface IFoo { bar: string }'));
    expect(symbols.some(s => s.name === 'IFoo' && s.kind === 'interface')).toBe(true);
  });

  it('[HP] extracts TS enum declaration', () => {
    const symbols = extractSymbolsOxc(file('enum Color { Red, Green, Blue }'));
    expect(symbols.some(s => s.name === 'Color' && s.kind === 'enum')).toBe(true);
  });

  it('[HP] span has start and end with line/column', () => {
    const symbols = extractSymbolsOxc(file('function f() {}'));
    const fn = symbols.find(s => s.name === 'f');
    expect(fn?.span.start).toBeDefined();
    expect(fn?.span.end).toBeDefined();
  });

  it('[NE] skips anonymous function expressions', () => {
    // IIFE — anonymous
    const symbols = extractSymbolsOxc(file('(function() {})();'));
    expect(symbols.every(s => s.name !== 'anonymous')).toBe(true);
  });

  it('[CO] extracts multiple symbols from one file', () => {
    const src = `
      function f() {}
      class C {}
      const g = () => {};
    `;
    const symbols = extractSymbolsOxc(file(src));
    const names = symbols.map(s => s.name);
    expect(names).toContain('f');
    expect(names).toContain('C');
    expect(names).toContain('g');
  });
});
