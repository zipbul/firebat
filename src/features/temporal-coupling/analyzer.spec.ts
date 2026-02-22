import { describe, expect, it } from 'bun:test';

import { parseSource } from '../../engine/parse-source';
import { analyzeTemporalCoupling, createEmptyTemporalCoupling } from './analyzer';

const file = (relPath: string, sourceText: string) => parseSource(`/p/${relPath}`, sourceText);

const fileWithErrors = (relPath: string, sourceText: string) => {
  const parsed = file(relPath, sourceText);

  return { ...parsed, errors: [{ message: 'synthetic' }] as any };
};

describe('temporal-coupling/analyzer', () => {
  // --- [NE] should return empty when files array is empty ---
  it('should return empty result when files are empty', () => {
    // Arrange
    const files: any[] = [];
    // Act
    const result = analyzeTemporalCoupling(files as any);
    // Assert
    expect(result).toEqual(createEmptyTemporalCoupling());
  });

  // --- [NE] should skip files with parse errors ---
  it('should ignore files with parse errors', () => {
    // Arrange
    const files = [
      fileWithErrors('src/a.ts', 'let db: number | null = null; export function init() { db = 1; }'),
      file('src/b.ts', 'export const x = 1;'),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);
    // Assert
    expect(result.length).toBe(0);
  });

  // --- [NE] should skip non-ts files ---
  it('should ignore non-ts files', () => {
    // Arrange
    const files = [file('src/a.js', 'let db = null; export function init() { db = 1; } export function query() { return db; }')];
    // Act
    const result = analyzeTemporalCoupling(files as any);
    // Assert
    expect(result.length).toBe(0);
  });

  // --- [HP] should detect module-scope let with writer(=) and reader ---
  it('should report temporal coupling when a module-scope variable is written and read by different exported functions', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        [
          'let db: number | null = null;',
          'export function initDb() { db = 1; }',
          'export function queryUsers() { return db; }',
        ].join('\n'),
      ),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);
    // Assert
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]?.kind).toBe('temporal-coupling');
    expect(result[0]?.state).toBe('db');
    expect(result[0]?.writers).toBe(1);
    expect(result[0]?.readers).toBe(1);
  });

  // --- [HP] should detect module-scope let with += assignment as writer ---
  it('should detect += assignment as writer', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        ['let total = 0;', 'export function add(n: number) { total += n; }', 'export function getTotal() { return total; }'].join(
          '\n',
        ),
      ),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);
    // Assert
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]?.state).toBe('total');
  });

  // --- [HP] should detect module-scope let with ++ (UpdateExpression) as writer ---
  it('should detect ++ (UpdateExpression) as writer', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        ['let count = 0;', 'export function increment() { count++; }', 'export function getCount() { return count; }'].join('\n'),
      ),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);
    // Assert
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]?.state).toBe('count');
  });

  // --- [HP] should emit one finding per reader when multiple readers exist ---
  it('should emit one finding per reader when one writer feeds multiple readers', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        [
          'let conn: object | null = null;',
          'export function connect() { conn = {}; }',
          'export function q1() { return conn; }',
          'export function q2() { return conn; }',
          'export function q3() { return conn; }',
        ].join('\n'),
      ),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);
    // Assert
    expect(result.length).toBe(3);
    expect(result[0]?.writers).toBe(1);
    expect(result[0]?.readers).toBe(3);
  });

  // --- [HP] should detect class state property with init writer and query reader ---
  it('should report temporal coupling for class init/query guard patterns', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        [
          'export class Service {',
          '  private initialized = false;',
          '  init() { this.initialized = true; }',
          '  query() { if (!this.initialized) throw new Error("not ready"); return 1; }',
          '}',
        ].join('\n'),
      ),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);
    // Assert
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]?.state).toBe('initialized');
  });

  // --- [HP] should detect multiple module-scope let vars independently ---
  it('should detect multiple module-scope let vars independently', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        [
          'let host = "";',
          'let port = 0;',
          'export function configure(h: string, p: number) { host = h; port = p; }',
          'export function getHost() { return host; }',
          'export function getPort() { return port; }',
        ].join('\n'),
      ),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);
    // Assert
    // Both host and port should be detected
    const states = result.map(r => r.state);

    expect(states).toContain('host');
    expect(states).toContain('port');
  });

  // --- [HP] should detect class with multiple state properties independently ---
  it('should detect class with multiple state properties independently', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        [
          'export class Cache {',
          '  private ready = false;',
          '  private size = 0;',
          '  start() { this.ready = true; this.size = 100; }',
          '  isReady() { return this.ready; }',
          '  getSize() { return this.size; }',
          '}',
        ].join('\n'),
      ),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);
    // Assert
    const states = result.map(r => r.state);

    expect(states).toContain('ready');
    expect(states).toContain('size');
  });

  // --- [NE] should not report const declarations ---
  it('should not report const declarations', () => {
    // Arrange
    const files = [
      file('src/a.ts', ['const data = [];', 'export function getData() { return data; }'].join('\n')),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);
    // Assert
    expect(result.length).toBe(0);
  });

  // --- [NE] should not report when only writers exist (no readers) ---
  it('should not report when there are no readers', () => {
    // Arrange
    const files = [
      file('src/a.ts', ['let x = 0;', 'export function set() { x = 1; }', 'export function a() { return 1; }'].join('\n')),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);
    // Assert
    expect(result.length).toBe(0);
  });

  // --- [NE] should not report when file has no exported functions ---
  it('should not report when file has no exported functions', () => {
    // Arrange
    const files = [
      file('src/a.ts', ['let x = 0;', 'function set() { x = 1; }', 'function get() { return x; }'].join('\n')),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);
    // Assert
    expect(result.length).toBe(0);
  });

  // --- [ED] should not report let with no functions in file ---
  it('should not report let with no functions in file', () => {
    // Arrange
    const files = [file('src/a.ts', 'let x = 0;')];
    // Act
    const result = analyzeTemporalCoupling(files as any);
    // Assert
    expect(result.length).toBe(0);
  });

  // --- [CO] should not self-detect when variable is named 'initialized' ---
  it('should not self-detect when source contains keywords like initialized without temporal coupling pattern', () => {
    // Arrange — a file that uses 'initialized' as a plain variable but has no writer/reader split
    const files = [
      file(
        'src/a.ts',
        ['const initialized = true;', 'export function check() { return initialized; }'].join('\n'),
      ),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);
    // Assert — const is not let/var, no temporal coupling
    expect(result.length).toBe(0);
  });

  // --- [CO] should handle file with both module-scope let and class state ---
  it('should handle file with both module-scope let and class state', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        [
          'let globalFlag = false;',
          'export function setGlobal() { globalFlag = true; }',
          'export function getGlobal() { return globalFlag; }',
          'export class Worker {',
          '  private active = false;',
          '  start() { this.active = true; }',
          '  isActive() { return this.active; }',
          '}',
        ].join('\n'),
      ),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);
    // Assert
    const states = result.map(r => r.state);

    expect(states).toContain('globalFlag');
    expect(states).toContain('active');
  });

  // --- [ID] should return identical results for same input ---
  it('should return identical results for same input when called twice', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        ['let db: number | null = null;', 'export function init() { db = 1; }', 'export function get() { return db; }'].join(
          '\n',
        ),
      ),
    ];
    // Act
    const result1 = analyzeTemporalCoupling(files as any);
    const result2 = analyzeTemporalCoupling(files as any);
    // Assert
    expect(result1).toEqual(result2);
  });

  // --- [OR] should produce consistent results regardless of file order ---
  it('should produce consistent results regardless of file order', () => {
    // Arrange
    const f1 = file(
      'src/a.ts',
      ['let x = 0;', 'export function setX() { x = 1; }', 'export function getX() { return x; }'].join('\n'),
    );
    const f2 = file(
      'src/b.ts',
      ['let y = 0;', 'export function setY() { y = 1; }', 'export function getY() { return y; }'].join('\n'),
    );
    // Act
    const result1 = analyzeTemporalCoupling([f1, f2] as any);
    const result2 = analyzeTemporalCoupling([f2, f1] as any);
    // Assert — same findings regardless of order (sorted by file)
    const sorted1 = [...result1].sort((a, b) => a.file.localeCompare(b.file));
    const sorted2 = [...result2].sort((a, b) => a.file.localeCompare(b.file));

    expect(sorted1).toEqual(sorted2);
  });
});
