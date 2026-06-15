import { describe, expect, it } from 'bun:test';

import { expectBaseFinding, scanDetectorFindings } from '../../shared/scan-fixture';

interface BaseFindingCase {
  readonly title: string;
  readonly prefix: string;
  readonly source: ReadonlyArray<string>;
}

const baseFindingCases: BaseFindingCase[] = [
  {
    title: 'a module-scope let is written in init and read in query',
    prefix: 'p1-temporal-1',
    source: [
      'let db: number | null = null;',
      'export function initDb() { db = 1; }',
      'export function queryUsers() { return db; }',
    ],
  },
  {
    title: 'a module-scope var is assigned in one exported function and read in another',
    prefix: 'p1-temporal-2',
    source: [
      'var token: string | undefined;',
      'export function setToken(v: string) { token = v; }',
      'export function getToken() { return token?.toUpperCase(); }',
    ],
  },
  {
    title: 'a class method relies on an init guard set by another method',
    prefix: 'p1-temporal-3',
    source: [
      'export class Service {',
      '  private initialized = false;',
      '  init() { this.initialized = true; }',
      '  query() { if (!this.initialized) throw new Error("not ready"); return 1; }',
      '}',
    ],
  },
];

describe('integration/temporal-coupling', () => {
  it.each(baseFindingCases)('should report temporal coupling when $title', async ({ prefix, source }) => {
    // Act
    const list = await scanDetectorFindings(prefix, 'temporal-coupling', {
      'src/a.ts': source.join('\n'),
    });

    // Assert
    expect(list.length).toBeGreaterThan(0);

    for (const item of list) {
      expectBaseFinding(item, 'temporal-coupling');
    }
  });

  it('should report multiple temporal couplings when one writer feeds multiple readers', async () => {
    // Act
    const list = await scanDetectorFindings('p1-temporal-4', 'temporal-coupling', {
      'src/a.ts': [
        'let conn: object | null = null;',
        'export function connect() { conn = {}; }',
        'export function q1() { return conn; }',
        'export function q2() { return conn; }',
        'export function q3() { return conn; }',
      ].join('\n'),
    });

    // Assert
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  it('should report temporal coupling even when the write is a compound assignment', async () => {
    // Act
    const list = await scanDetectorFindings('p1-temporal-5', 'temporal-coupling', {
      'src/a.ts': [
        'let counter = 0;',
        'export function bump() { counter += 1; }',
        'export function read() { return counter; }',
      ].join('\n'),
    });

    // Assert
    expect(list.length).toBeGreaterThan(0);
  });

  it('should not report temporal coupling when state is function-scoped and not shared across exports', async () => {
    // Act
    const list = await scanDetectorFindings('p1-temporal-neg-1', 'temporal-coupling', {
      'src/a.ts': [
        'export function f() {',
        '  let x = 0;',
        '  x += 1;',
        '  return x;',
        '}',
        'export function g() {',
        '  return 1;',
        '}',
      ].join('\n'),
    });

    // Assert
    expect(list.length).toBe(0);
  });
});
