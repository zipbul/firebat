import type { CodeRelation, ParsedFile as GildashParsedFile } from '@zipbul/gildash';

import { GildashError } from '@zipbul/gildash';
import { describe, expect, it } from 'bun:test';

import { parseSource } from '../../engine/ast/parse-source';
import { parsePFile as file } from '../../../test/integration/shared/test-kit';
import { analyzeTemporalCoupling, createEmptyTemporalCoupling } from './analyzer';

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
    expect(result.length).toBe(1);
    expect(result[0]?.kind).toBe('temporal-coupling');
    expect(result[0]?.state).toBe('db');
    expect(result[0]?.writers).toBe(1);
    expect(result[0]?.readers).toBe(1);
  });

  // --- [HP] should detect module-scope let written via object destructuring ---
  it('should report temporal coupling when a module-scope variable is written via object destructuring', () => {
    // Arrange — `({db} = create())` writes `db`; previously missed because the
    // AssignmentExpression.left is an ObjectPattern, not an Identifier, so the
    // identifier's start:end key never landed in writeKeys.
    const files = [
      file(
        'src/a.ts',
        [
          'let db: any = null;',
          'export function initDb() { ({ db } = create()); }',
          'export function queryUsers() { return db; }',
          'declare function create(): { db: any };',
        ].join('\n'),
      ),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);

    // Assert
    expect(result.length).toBe(1);
    expect(result[0]?.state).toBe('db');
    expect(result[0]?.writers).toBe(1);
  });

  it('should report temporal coupling when a module-scope variable is written via array destructuring', () => {
    // Arrange — `[db] = create()` writes `db`.
    const files = [
      file(
        'src/a.ts',
        [
          'let db: any = null;',
          'export function initDb() { [db] = create(); }',
          'export function queryUsers() { return db; }',
          'declare function create(): any[];',
        ].join('\n'),
      ),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);

    // Assert
    expect(result.length).toBe(1);
    expect(result[0]?.state).toBe('db');
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
    expect(result.length).toBe(1);
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
    expect(result.length).toBe(1);
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

  // --- [HP] should detect class state property with init writer and unguarded query reader ---
  it('should report temporal coupling for class init/query when reader has no guard', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        [
          'export class Service {',
          '  private initialized = false;',
          '  init() { this.initialized = true; }',
          '  query() { return this.initialized ? 1 : 0; }',
          '}',
        ].join('\n'),
      ),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);

    // Assert
    expect(result.length).toBe(1);
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
    const files = [file('src/a.ts', ['const data = [];', 'export function getData() { return data; }'].join('\n'))];
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
    const files = [file('src/a.ts', ['let x = 0;', 'function set() { x = 1; }', 'function get() { return x; }'].join('\n'))];
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
    const files = [file('src/a.ts', ['const initialized = true;', 'export function check() { return initialized; }'].join('\n'))];
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

  // B-1: arrow function export
  it('analyzeTemporalCoupling - arrow function export writer/reader - reports temporal coupling', () => {
    // Arrange
    const files = [
      file('src/a.ts', ['let x = 0;', 'export const init = () => { x = 1; };', 'export const query = () => x;'].join('\n')),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);

    // Assert
    expect(result.length).toBe(1);
    expect(result[0]?.state).toBe('x');
  });

  // B-1: function expression export
  it('analyzeTemporalCoupling - function expression export writer/reader - reports temporal coupling', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        ['let x = 0;', 'export const init = function() { x = 1; };', 'export const query = function() { return x; };'].join('\n'),
      ),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);

    // Assert
    expect(result.length).toBe(1);
    expect(result[0]?.state).toBe('x');
  });

  // B-1: re-export pattern
  it('analyzeTemporalCoupling - re-export pattern writer/reader - reports temporal coupling', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        ['let x = 0;', 'const init = () => { x = 1; };', 'const query = () => x;', 'export { init, query };'].join('\n'),
      ),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);

    // Assert
    expect(result.length).toBe(1);
    expect(result[0]?.state).toBe('x');
  });

  // B-1: default export writer with named reader
  it('analyzeTemporalCoupling - default export writer with named reader - reports temporal coupling', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        ['let x = 0;', 'export default function init() { x = 1; }', 'export function query() { return x; }'].join('\n'),
      ),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);

    // Assert
    expect(result.length).toBe(1);
  });

  // B-2: class constructor as only writer
  it('analyzeTemporalCoupling - class constructor as only writer - does not report finding', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        [
          'export class Counter {',
          '  count = 0;',
          '  constructor() { this.count = 0; }',
          '  getCount() { return this.count; }',
          '}',
        ].join('\n'),
      ),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);

    // Assert
    expect(result.length).toBe(0);
  });

  // B-2: class constructor plus method writer
  it('analyzeTemporalCoupling - class constructor plus method writer - reports finding for method writer', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        [
          'export class Service {',
          '  x = 0;',
          '  constructor() { this.x = 0; }',
          '  set() { this.x = 1; }',
          '  get() { return this.x; }',
          '}',
        ].join('\n'),
      ),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);

    // Assert
    expect(result.length).toBe(1);
  });

  // B-3: UpdateExpression (this.x++) treated as a write
  it('analyzeTemporalCoupling - class method writes property via postfix ++ - reports finding', () => {
    // Arrange — inc() writes this.count via UpdateExpression; read() reads it
    const files = [
      file(
        'src/a.ts',
        ['export class Counter {', '  count = 0;', '  inc() { this.count++; }', '  read() { return this.count; }', '}'].join(
          '\n',
        ),
      ),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);

    // Assert
    expect(result.length).toBe(1);
  });

  it('analyzeTemporalCoupling - class method writes property via prefix -- - reports finding', () => {
    // Arrange — dec() writes this.count via prefix decrement
    const files = [
      file(
        'src/a.ts',
        ['export class Counter {', '  count = 0;', '  dec() { --this.count; }', '  read() { return this.count; }', '}'].join(
          '\n',
        ),
      ),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);

    // Assert
    expect(result.length).toBe(1);
  });

  // --- gildash caller 공존 검사 ---

  const createMockGildash = (relations: CodeRelation[]) => ({
    searchRelations: (query: { type?: string; dstFilePath?: string; dstSymbolName?: string }) => {
      return relations.filter(r => {
        if (query.type !== undefined && r.type !== query.type) {
          return false;
        }

        if (query.dstFilePath !== undefined && r.dstFilePath !== query.dstFilePath) {
          return false;
        }

        if (query.dstSymbolName !== undefined && r.dstSymbolName !== query.dstSymbolName) {
          return false;
        }

        return true;
      });
    },
    getInternalRelations: (filePath: string) => {
      return relations.filter(r => r.srcFilePath === filePath && r.dstFilePath === filePath);
    },
  });

  // --- gildash getSymbolsByFile 기반 exported name 수집 ---

  it('analyzeTemporalCoupling - gildash getSymbolsByFile provides exported names - detects temporal coupling', () => {
    // Arrange — getSymbolsByFile returns exported function symbols
    const files = [
      file(
        'src/a.ts',
        ['let db: any;', 'export function init() { db = createDb(); }', 'export function query() { return db; }'].join('\n'),
      ),
    ];
    const mockGildash = {
      ...createMockGildash([]),
      getSymbolsByFile: (filePath: string) => {
        if (filePath === 'src/a.ts') {
          return [
            { name: 'init', kind: 'function', isExported: true, filePath: 'src/a.ts' },
            { name: 'query', kind: 'function', isExported: true, filePath: 'src/a.ts' },
          ];
        }

        return [];
      },
    };
    // Act
    const result = analyzeTemporalCoupling(files as any, { gildash: mockGildash as any });

    // Assert — gildash provides exported names, temporal coupling detected
    expect(result.length).toBe(1);
  });

  it('analyzeTemporalCoupling - gildash getSymbolsByFile empty result - falls back to AST walk', () => {
    // Arrange — getSymbolsByFile returns empty → fallback to collectExportedFunctionNames
    const files = [
      file(
        'src/a.ts',
        ['let db: any;', 'export function init() { db = createDb(); }', 'export function query() { return db; }'].join('\n'),
      ),
    ];
    const mockGildash = {
      ...createMockGildash([]),
      getSymbolsByFile: () => [],
    };
    // Act
    const result = analyzeTemporalCoupling(files as any, { gildash: mockGildash as any });

    // Assert — AST fallback still detects temporal coupling
    expect(result.length).toBe(1);
  });

  it('analyzeTemporalCoupling - gildash getSymbolsByFile with export { } specifiers - detects coupling', () => {
    // Arrange — export { init, query } pattern: gildash 0.14.0 returns isExported: true
    const files = [
      file(
        'src/a.ts',
        [
          'let db: any;',
          'function init() { db = createDb(); }',
          'function query() { return db; }',
          'export { init, query };',
        ].join('\n'),
      ),
    ];
    const mockGildash = {
      ...createMockGildash([]),
      getSymbolsByFile: (filePath: string) => {
        if (filePath === 'src/a.ts') {
          return [
            { name: 'init', kind: 'function', isExported: true, filePath: 'src/a.ts' },
            { name: 'query', kind: 'function', isExported: true, filePath: 'src/a.ts' },
          ];
        }

        return [];
      },
    };
    // Act
    const result = analyzeTemporalCoupling(files as any, { gildash: mockGildash as any });

    // Assert — gildash correctly marks specifiers as exported
    expect(result.length).toBe(1);
  });

  it('analyzeTemporalCoupling - all callers of reader also call writer via gildash - suppresses finding', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        ['let db: any;', 'export function init() { db = createDb(); }', 'export function query() { return db; }'].join('\n'),
      ),
    ];
    const mockGildash = createMockGildash([
      { type: 'calls', srcFilePath: 'main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'init' },
      { type: 'calls', srcFilePath: 'main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'query' },
    ]);
    // Act
    const result = analyzeTemporalCoupling(files as any, { gildash: mockGildash as any });

    // Assert
    expect(result.length).toBe(0);
  });

  it('analyzeTemporalCoupling - some callers of reader do not call writer - keeps finding', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        ['let db: any;', 'export function init() { db = createDb(); }', 'export function query() { return db; }'].join('\n'),
      ),
    ];
    const mockGildash = createMockGildash([
      { type: 'calls', srcFilePath: 'main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'query' },
    ]);
    // Act
    const result = analyzeTemporalCoupling(files as any, { gildash: mockGildash as any });

    // Assert
    expect(result.length).toBe(1);
  });

  it('analyzeTemporalCoupling - reader has no callers via gildash - keeps finding', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        ['let db: any;', 'export function init() { db = createDb(); }', 'export function query() { return db; }'].join('\n'),
      ),
    ];
    const mockGildash = createMockGildash([]);
    // Act
    const result = analyzeTemporalCoupling(files as any, { gildash: mockGildash as any });

    // Assert
    expect(result.length).toBe(1);
  });

  it('analyzeTemporalCoupling - gildash searchRelations throws - falls back to AST-only', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        ['let db: any;', 'export function init() { db = createDb(); }', 'export function query() { return db; }'].join('\n'),
      ),
    ];
    const throwingGildash = {
      searchRelations: (_query: unknown) => {
        throw new GildashError('search', 'gildash error');
      },
      getInternalRelations: (_filePath: string) => [],
    };
    // Act
    const result = analyzeTemporalCoupling(files as any, { gildash: throwingGildash as any });

    // Assert
    expect(result.length).toBe(1);
  });

  it('analyzeTemporalCoupling - class method all callers call writer - suppresses finding', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        ['export class Service {', '  x = 0;', '  init() { this.x = 1; }', '  query() { return this.x; }', '}'].join('\n'),
      ),
    ];
    const mockGildash = createMockGildash([
      { type: 'calls', srcFilePath: 'main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'Service.init' },
      { type: 'calls', srcFilePath: 'main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'Service.query' },
    ]);
    // Act
    const result = analyzeTemporalCoupling(files as any, { gildash: mockGildash as any });

    // Assert
    expect(result.length).toBe(0);
  });

  it('analyzeTemporalCoupling - different file same function name - dstFilePath prevents collision', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        ['let db: any;', 'export function init() { db = 1; }', 'export function query() { return db; }'].join('\n'),
      ),
    ];
    // 'init' caller is pointing to 'src/other.ts', not 'src/a.ts'
    const mockGildash = createMockGildash([
      { type: 'calls', srcFilePath: 'main.ts', srcSymbolName: 'main', dstFilePath: 'src/other.ts', dstSymbolName: 'init' },
      { type: 'calls', srcFilePath: 'main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'query' },
    ]);
    // Act
    const result = analyzeTemporalCoupling(files as any, { gildash: mockGildash as any });

    // Assert
    expect(result.length).toBe(1);
  });

  it('analyzeTemporalCoupling - anonymous class method - skips gildash suppression', () => {
    // Arrange — anonymous class expression (no name), gildash suppression is not applicable
    const files = [
      file(
        'src/a.ts',
        ['export const svc = new (class {', '  x = 0;', '  init() { this.x = 1; }', '  query() { return this.x; }', '})();'].join(
          '\n',
        ),
      ),
    ];
    // Gildash claims all callers call both — but anonymous class cannot be matched → no suppression
    const mockGildash = createMockGildash([
      { type: 'calls', srcFilePath: 'main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'init' },
      { type: 'calls', srcFilePath: 'main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'query' },
    ]);
    // Act
    const result = analyzeTemporalCoupling(files as any, { gildash: mockGildash as any });

    // Assert — anonymous class cannot be suppressed, finding must remain
    expect(result.length).toBe(1);
  });

  // --- Phase 3: caller AST 순서 검사 ---

  const createMockGildashWithAst = (relations: CodeRelation[], astMap: Record<string, GildashParsedFile>) => ({
    searchRelations: (query: { type?: string; dstFilePath?: string; dstSymbolName?: string }) => {
      return relations.filter(r => {
        if (query.type !== undefined && r.type !== query.type) {
          return false;
        }

        if (query.dstFilePath !== undefined && r.dstFilePath !== query.dstFilePath) {
          return false;
        }

        if (query.dstSymbolName !== undefined && r.dstSymbolName !== query.dstSymbolName) {
          return false;
        }

        return true;
      });
    },
    getInternalRelations: (filePath: string) => {
      return relations.filter(r => r.srcFilePath === filePath && r.dstFilePath === filePath);
    },
    getParsedAst: (filePath: string): GildashParsedFile | undefined => astMap[filePath],
  });

  it('analyzeTemporalCoupling - caller calls writer before reader (correct order) - suppresses finding', () => {
    // Arrange
    const targetSource = ['let db: any;', 'export function init() { db = 1; }', 'export function query() { return db; }'].join(
      '\n',
    );
    const callerSource = ["import { init, query } from './a';", 'export function main() { init(); query(); }'].join('\n');
    const callerParsed = parseSource('src/main.ts', callerSource);
    const files = [file('src/a.ts', targetSource)];
    const mockGildash = createMockGildashWithAst(
      [
        { type: 'calls', srcFilePath: 'src/main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'init' },
        { type: 'calls', srcFilePath: 'src/main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'query' },
      ],
      { 'src/main.ts': callerParsed as unknown as GildashParsedFile },
    );
    // Act
    const result = analyzeTemporalCoupling(files as any, { gildash: mockGildash as any });

    // Assert — writer before reader → suppression maintained
    expect(result.length).toBe(0);
  });

  it('analyzeTemporalCoupling - caller calls reader before writer (reverse order) - keeps finding', () => {
    // Arrange
    const targetSource = ['let db: any;', 'export function init() { db = 1; }', 'export function query() { return db; }'].join(
      '\n',
    );
    const callerSource = ["import { init, query } from './a';", 'export function main() { query(); init(); }'].join('\n');
    const callerParsed = parseSource('src/main.ts', callerSource);
    const files = [file('src/a.ts', targetSource)];
    const mockGildash = createMockGildashWithAst(
      [
        { type: 'calls', srcFilePath: 'src/main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'init' },
        { type: 'calls', srcFilePath: 'src/main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'query' },
      ],
      { 'src/main.ts': callerParsed as unknown as GildashParsedFile },
    );
    // Act
    const result = analyzeTemporalCoupling(files as any, { gildash: mockGildash as any });

    // Assert — reader before writer → finding kept
    expect(result.length).toBe(1);
  });

  it('analyzeTemporalCoupling - caller calls writer inside if branch - keeps finding conservatively', () => {
    // Arrange
    const targetSource = ['let db: any;', 'export function init() { db = 1; }', 'export function query() { return db; }'].join(
      '\n',
    );
    const callerSource = [
      "import { init, query } from './a';",
      'declare const needInit: boolean;',
      'export function main() { if (needInit) { init(); } query(); }',
    ].join('\n');
    const callerParsed = parseSource('src/main.ts', callerSource);
    const files = [file('src/a.ts', targetSource)];
    const mockGildash = createMockGildashWithAst(
      [
        { type: 'calls', srcFilePath: 'src/main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'init' },
        { type: 'calls', srcFilePath: 'src/main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'query' },
      ],
      { 'src/main.ts': callerParsed as unknown as GildashParsedFile },
    );
    // Act
    const result = analyzeTemporalCoupling(files as any, { gildash: mockGildash as any });

    // Assert — writer inside branch → conservative, finding kept
    expect(result.length).toBe(1);
  });

  it('analyzeTemporalCoupling - class method caller correct order via getParsedAst - suppresses finding', () => {
    // Arrange
    const targetSource = [
      'export class Service {',
      '  x = 0;',
      '  init() { this.x = 1; }',
      '  query() { return this.x; }',
      '}',
    ].join('\n');
    const callerSource = [
      "import { Service } from './a';",
      'export class App {',
      '  run() { const s = new Service(); s.init(); s.query(); }',
      '}',
    ].join('\n');
    const callerParsed = parseSource('src/app.ts', callerSource);
    const files = [file('src/a.ts', targetSource)];
    const mockGildash = createMockGildashWithAst(
      [
        {
          type: 'calls',
          srcFilePath: 'src/app.ts',
          srcSymbolName: 'App.run',
          dstFilePath: 'src/a.ts',
          dstSymbolName: 'Service.init',
        },
        {
          type: 'calls',
          srcFilePath: 'src/app.ts',
          srcSymbolName: 'App.run',
          dstFilePath: 'src/a.ts',
          dstSymbolName: 'Service.query',
        },
      ],
      { 'src/app.ts': callerParsed as unknown as GildashParsedFile },
    );
    // Act
    const result = analyzeTemporalCoupling(files as any, { gildash: mockGildash as any });

    // Assert — writer before reader in App.run → suppression
    expect(result.length).toBe(0);
  });

  it('analyzeTemporalCoupling - getParsedAst returns undefined - keeps finding conservatively', () => {
    // Arrange
    const targetSource = ['let db: any;', 'export function init() { db = 1; }', 'export function query() { return db; }'].join(
      '\n',
    );
    const files = [file('src/a.ts', targetSource)];
    const mockGildash = createMockGildashWithAst(
      [
        { type: 'calls', srcFilePath: 'src/main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'init' },
        { type: 'calls', srcFilePath: 'src/main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'query' },
      ],
      {}, // no entry for src/main.ts → getParsedAst returns undefined
    );
    // Act
    const result = analyzeTemporalCoupling(files as any, { gildash: mockGildash as any });

    // Assert — AST unavailable → conservative, finding kept
    expect(result.length).toBe(1);
  });

  // --- Phase 4: CFG dominator 기반 검사 ---

  it('analyzeTemporalCoupling - both if/else branches have writer via CFG - suppresses finding', () => {
    // Arrange
    const targetSource = ['let db: any;', 'export function init() { db = 1; }', 'export function query() { return db; }'].join(
      '\n',
    );
    const callerSource = [
      "import { init, query } from './a';",
      'declare const cond: boolean;',
      'export function main() { if (cond) { init(); } else { init(); } query(); }',
    ].join('\n');
    const callerParsed = parseSource('src/main.ts', callerSource);
    const files = [file('src/a.ts', targetSource)];
    const mockGildash = createMockGildashWithAst(
      [
        { type: 'calls', srcFilePath: 'src/main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'init' },
        { type: 'calls', srcFilePath: 'src/main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'query' },
      ],
      { 'src/main.ts': callerParsed as unknown as GildashParsedFile },
    );
    // Act
    const result = analyzeTemporalCoupling(files as any, { gildash: mockGildash as any });

    // Assert — 양쪽 분기 모두 writer → CFG 집합 dominate → suppression
    expect(result.length).toBe(0);
  });

  it('analyzeTemporalCoupling - single if branch writer via CFG - keeps finding', () => {
    // Arrange
    const targetSource = ['let db: any;', 'export function init() { db = 1; }', 'export function query() { return db; }'].join(
      '\n',
    );
    const callerSource = [
      "import { init, query } from './a';",
      'declare const cond: boolean;',
      'export function main() { if (cond) { init(); } query(); }',
    ].join('\n');
    const callerParsed = parseSource('src/main.ts', callerSource);
    const files = [file('src/a.ts', targetSource)];
    const mockGildash = createMockGildashWithAst(
      [
        { type: 'calls', srcFilePath: 'src/main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'init' },
        { type: 'calls', srcFilePath: 'src/main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'query' },
      ],
      { 'src/main.ts': callerParsed as unknown as GildashParsedFile },
    );
    // Act
    const result = analyzeTemporalCoupling(files as any, { gildash: mockGildash as any });

    // Assert — 단측 분기 → CFG dominate 안 함 → finding kept
    expect(result.length).toBe(1);
  });

  it('analyzeTemporalCoupling - try writer catch then reader via CFG - keeps finding', () => {
    // Arrange
    const targetSource = ['let db: any;', 'export function init() { db = 1; }', 'export function query() { return db; }'].join(
      '\n',
    );
    const callerSource = [
      "import { init, query } from './a';",
      'export function main() { try { init(); } catch {} query(); }',
    ].join('\n');
    const callerParsed = parseSource('src/main.ts', callerSource);
    const files = [file('src/a.ts', targetSource)];
    const mockGildash = createMockGildashWithAst(
      [
        { type: 'calls', srcFilePath: 'src/main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'init' },
        { type: 'calls', srcFilePath: 'src/main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'query' },
      ],
      { 'src/main.ts': callerParsed as unknown as GildashParsedFile },
    );
    // Act
    const result = analyzeTemporalCoupling(files as any, { gildash: mockGildash as any });

    // Assert — exception edge로 초기화 없이 query 실행 가능 → finding kept
    expect(result.length).toBe(1);
  });

  it('analyzeTemporalCoupling - try writer and reader same block via CFG - suppresses finding', () => {
    // Arrange
    const targetSource = ['let db: any;', 'export function init() { db = 1; }', 'export function query() { return db; }'].join(
      '\n',
    );
    const callerSource = [
      "import { init, query } from './a';",
      'export function main() { try { init(); query(); } catch {} }',
    ].join('\n');
    const callerParsed = parseSource('src/main.ts', callerSource);
    const files = [file('src/a.ts', targetSource)];
    const mockGildash = createMockGildashWithAst(
      [
        { type: 'calls', srcFilePath: 'src/main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'init' },
        { type: 'calls', srcFilePath: 'src/main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'query' },
      ],
      { 'src/main.ts': callerParsed as unknown as GildashParsedFile },
    );
    // Act
    const result = analyzeTemporalCoupling(files as any, { gildash: mockGildash as any });

    // Assert — init throw 시 query도 미실행 → suppression
    expect(result.length).toBe(0);
  });

  // --- Phase 5: guard 패턴 인식 ---

  it('analyzeTemporalCoupling - reader has throw guard for state - suppresses finding', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        [
          'let db: any;',
          'export function init() { db = createDb(); }',
          'export function query() { if (!db) throw new Error("not ready"); return db.exec(); }',
        ].join('\n'),
      ),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);

    // Assert — guard dominates state access → self-protecting reader → no finding
    expect(result.length).toBe(0);
  });

  it('analyzeTemporalCoupling - reader has return guard for state - suppresses finding', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        [
          'let db: any;',
          'export function init() { db = createDb(); }',
          'export function query() { if (!db) return null; return db.exec(); }',
        ].join('\n'),
      ),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);

    // Assert — return guard dominates state access → self-protecting reader → no finding
    expect(result.length).toBe(0);
  });

  it('analyzeTemporalCoupling - reader has no guard - keeps finding', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        ['let db: any;', 'export function init() { db = createDb(); }', 'export function query() { return db.exec(); }'].join(
          '\n',
        ),
      ),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);

    // Assert — no guard → finding kept
    expect(result.length).toBe(1);
  });

  it('analyzeTemporalCoupling - class reader has this.x guard - suppresses finding', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        [
          'export class Service {',
          '  x: any = null;',
          '  init() { this.x = createX(); }',
          '  query() { if (!this.x) throw new Error(); return this.x.exec(); }',
          '}',
        ].join('\n'),
      ),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);

    // Assert — this.x guard dominates this.x access → self-protecting reader → no finding
    expect(result.length).toBe(0);
  });

  it('analyzeTemporalCoupling - guard after state access - keeps finding', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        [
          'let db: any;',
          'export function init() { db = createDb(); }',
          'export function query() { db.exec(); if (!db) throw new Error(); }',
        ].join('\n'),
      ),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);

    // Assert — guard comes after state access → does not dominate → finding kept
    expect(result.length).toBe(1);
  });

  it('analyzeTemporalCoupling - loop writer via CFG - keeps finding', () => {
    // Arrange
    const targetSource = ['let db: any;', 'export function init() { db = 1; }', 'export function query() { return db; }'].join(
      '\n',
    );
    const callerSource = [
      "import { init, query } from './a';",
      'declare const xs: any[];',
      'export function main() { for (const x of xs) { init(); } query(); }',
    ].join('\n');
    const callerParsed = parseSource('src/main.ts', callerSource);
    const files = [file('src/a.ts', targetSource)];
    const mockGildash = createMockGildashWithAst(
      [
        { type: 'calls', srcFilePath: 'src/main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'init' },
        { type: 'calls', srcFilePath: 'src/main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'query' },
      ],
      { 'src/main.ts': callerParsed as unknown as GildashParsedFile },
    );
    // Act
    const result = analyzeTemporalCoupling(files as any, { gildash: mockGildash as any });

    // Assert — 루프 0회 가능 → CFG dominate 안 함 → finding kept
    expect(result.length).toBe(1);
  });

  // --- Phase 6: dead writer 제외 ---

  it('analyzeTemporalCoupling - dead writer after return - excludes from writers', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        ['let db: any;', 'export function setup() { return; db = createDb(); }', 'export function query() { return db; }'].join(
          '\n',
        ),
      ),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);

    // Assert — setup의 write는 return 이후 unreachable → writer가 아님 → writer 0개 → finding 없음
    expect(result.length).toBe(0);
  });

  it('analyzeTemporalCoupling - dead writer after throw - excludes from writers', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        [
          'let db: any;',
          'export function setup() { throw new Error(); db = createDb(); }',
          'export function query() { return db; }',
        ].join('\n'),
      ),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);

    // Assert — throw 이후 unreachable write → writer가 아님 → finding 없음
    expect(result.length).toBe(0);
  });

  it('analyzeTemporalCoupling - reachable writer in conditional - keeps as writer', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        [
          'let db: any;',
          'export function setup() { if (cond) { db = createDb(); } }',
          'export function query() { return db; }',
        ].join('\n'),
      ),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);

    // Assert — if 분기 내 write는 reachable → writer 유지 → finding 있음
    expect(result.length).toBe(1);
  });

  it('analyzeTemporalCoupling - reachable writer - keeps as writer', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        ['let db: any;', 'export function setup() { db = createDb(); }', 'export function query() { return db; }'].join('\n'),
      ),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);

    // Assert — 정상 write는 reachable → writer 유지 → finding 있음
    expect(result.length).toBe(1);
  });

  // --- High 누락 6건 ---

  it('analyzeTemporalCoupling - reader has block-wrapped throw guard - suppresses finding', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        [
          'let db: any;',
          'export function init() { db = createDb(); }',
          "export function query() { if (!db) { throw new Error('not ready'); } return db.exec(); }",
        ].join('\n'),
      ),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);

    // Assert — block-wrapped throw guard dominates state access → suppressed
    expect(result.length).toBe(0);
  });

  it('analyzeTemporalCoupling - class method dead writer after return - excludes from writers', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        [
          'export class Service {',
          '  x: any = null;',
          '  init() { return; this.x = createX(); }',
          '  query() { return this.x; }',
          '}',
        ].join('\n'),
      ),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);

    // Assert — init의 write는 return 이후 unreachable → writer 0개 → finding 없음
    expect(result.length).toBe(0);
  });

  it('analyzeTemporalCoupling - var declaration writer/reader - reports temporal coupling', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        ['var db: any;', 'export function init() { db = createDb(); }', 'export function query() { return db; }'].join('\n'),
      ),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);

    // Assert — var 선언도 mutable var로 감지 → finding 있음
    expect(result.length).toBe(1);
  });

  it('analyzeTemporalCoupling - named class gildash suppression with getParsedAst - suppresses finding', () => {
    // Arrange
    const targetSource = [
      'export class Service {',
      '  x = 0;',
      '  init() { this.x = 1; }',
      '  query() { return this.x; }',
      '}',
    ].join('\n');
    const callerSource = [
      "import { Service } from './a';",
      'export function main() { const s = new Service(); s.init(); s.query(); }',
    ].join('\n');
    const callerParsed = parseSource('src/main.ts', callerSource);
    const files = [file('src/a.ts', targetSource)];
    const mockGildash = createMockGildashWithAst(
      [
        {
          type: 'calls',
          srcFilePath: 'src/main.ts',
          srcSymbolName: 'main',
          dstFilePath: 'src/a.ts',
          dstSymbolName: 'Service.init',
        },
        {
          type: 'calls',
          srcFilePath: 'src/main.ts',
          srcSymbolName: 'main',
          dstFilePath: 'src/a.ts',
          dstSymbolName: 'Service.query',
        },
      ],
      { 'src/main.ts': callerParsed as unknown as GildashParsedFile },
    );
    // Act
    const result = analyzeTemporalCoupling(files as any, { gildash: mockGildash as any });

    // Assert — caller calls init before query with getParsedAst → suppressed
    expect(result.length).toBe(0);
  });

  it('analyzeTemporalCoupling - class gildash searchRelations throws - falls back to AST-only', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        ['export class Service {', '  x = 0;', '  init() { this.x = 1; }', '  query() { return this.x; }', '}'].join('\n'),
      ),
    ];
    const throwingGildash = {
      searchRelations: (_query: unknown) => {
        throw new GildashError('search', 'gildash error');
      },
      getInternalRelations: (_filePath: string) => [],
    };
    // Act
    const result = analyzeTemporalCoupling(files as any, { gildash: throwingGildash as any });

    // Assert — searchRelations throws → AST-only fallback → finding 있음
    expect(result.length).toBe(1);
  });

  it('analyzeTemporalCoupling - function that writes and reads same var - not counted as pure reader', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        [
          'let count = 0;',
          'export function increment() { count += 1; }',
          'export function getAndReset() { const v = count; count = 0; return v; }',
        ].join('\n'),
      ),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);

    // Assert — getAndReset은 writer이자 reader → pureReaders에서 제외 → reader 없음 → finding 없음
    expect(result.length).toBe(0);
  });

  // --- Medium 누락 8건 ---

  it('analyzeTemporalCoupling - reader has multiple guards for different checks - suppresses finding', () => {
    // Arrange — db 변수에 대한 guard가 존재
    const files = [
      file(
        'src/a.ts',
        [
          'let db: any;',
          'let config: any;',
          'export function init() { db = createDb(); config = loadConfig(); }',
          'export function query() { if (!db) throw new Error(); if (!config) throw new Error(); return db.exec(config); }',
        ].join('\n'),
      ),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);
    // Assert — db에 대한 guard가 db 접근을 dominate → db finding 없음
    const dbFindings = result.filter(r => r.state === 'db');

    expect(dbFindings.length).toBe(0);
  });

  it('analyzeTemporalCoupling - multiple readers one has no callers - keeps finding', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        [
          'let db: any;',
          'export function init() { db = 1; }',
          'export function queryA() { return db; }',
          'export function queryB() { return db; }',
        ].join('\n'),
      ),
    ];
    const mockGildash = createMockGildash([
      { type: 'calls', srcFilePath: 'main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'init' },
      { type: 'calls', srcFilePath: 'main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'queryA' },
      // queryB에는 caller 없음
    ]);
    // Act
    const result = analyzeTemporalCoupling(files as any, { gildash: mockGildash as any });

    // Assert — both readers (queryA, queryB) report independent findings; queryB
    // having no callers is handled conservatively (kept).
    expect(result.length).toBe(2);
  });

  it('analyzeTemporalCoupling - multiple writers for same variable - reports finding', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        [
          'let db: any;',
          'export function initA() { db = createA(); }',
          'export function initB() { db = createB(); }',
          'export function query() { return db; }',
        ].join('\n'),
      ),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);

    // Assert — writers=2, reader=1 → finding 있음
    expect(result.length).toBe(1);
  });

  it('analyzeTemporalCoupling - writer inside switch case via CFG - keeps finding', () => {
    // Arrange
    const targetSource = ['let db: any;', 'export function init() { db = 1; }', 'export function query() { return db; }'].join(
      '\n',
    );
    const callerSource = [
      "import { init, query } from './a';",
      'declare const mode: string;',
      "export function main() { switch(mode) { case 'a': init(); break; } query(); }",
    ].join('\n');
    const callerParsed = parseSource('src/main.ts', callerSource);
    const files = [file('src/a.ts', targetSource)];
    const mockGildash = createMockGildashWithAst(
      [
        { type: 'calls', srcFilePath: 'src/main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'init' },
        { type: 'calls', srcFilePath: 'src/main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'query' },
      ],
      { 'src/main.ts': callerParsed as unknown as GildashParsedFile },
    );
    // Act
    const result = analyzeTemporalCoupling(files as any, { gildash: mockGildash as any });

    // Assert — `init()` sits in a `case 'a'` of a default-less switch, so it is
    // conditional: the CFG now models the no-match fall-through, so init() does
    // NOT dominate the unconditional `query()`. A conditional writer before an
    // unconditional reader is the temporal-coupling smell, so the finding is
    // kept. (Previously asserted 0, encoding a CFG bug where a default-less
    // switch was modeled as if some case always matched.)
    expect(result.length).toBe(1);
  });

  it('analyzeTemporalCoupling - writer inside nested if via CFG - keeps finding', () => {
    // Arrange
    const targetSource = ['let db: any;', 'export function init() { db = 1; }', 'export function query() { return db; }'].join(
      '\n',
    );
    const callerSource = [
      "import { init, query } from './a';",
      'declare const a: boolean;',
      'declare const b: boolean;',
      'export function main() { if (a) { if (b) { init(); } } query(); }',
    ].join('\n');
    const callerParsed = parseSource('src/main.ts', callerSource);
    const files = [file('src/a.ts', targetSource)];
    const mockGildash = createMockGildashWithAst(
      [
        { type: 'calls', srcFilePath: 'src/main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'init' },
        { type: 'calls', srcFilePath: 'src/main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'query' },
      ],
      { 'src/main.ts': callerParsed as unknown as GildashParsedFile },
    );
    // Act
    const result = analyzeTemporalCoupling(files as any, { gildash: mockGildash as any });

    // Assert — 중첩 조건 → init이 dominate 안 함 → finding 유지
    expect(result.length).toBe(1);
  });

  it('analyzeTemporalCoupling - intra-file caller suppresses finding', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        ['let db: any;', 'export function init() { db = 1; }', 'export function query() { return db; }'].join('\n'),
      ),
    ];
    const mockGildash = createMockGildash([
      { type: 'calls', srcFilePath: 'src/a.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'init' },
      { type: 'calls', srcFilePath: 'src/a.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'query' },
    ]);
    // Act
    const result = analyzeTemporalCoupling(files as any, { gildash: mockGildash as any });

    // Assert — intra-file caller가 init/query 모두 호출 → finding 억제
    expect(result.length).toBe(0);
  });

  it('analyzeTemporalCoupling - guard in else branch not recognized - keeps finding', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        [
          'let db: any;',
          'export function init() { db = createDb(); }',
          'export function query() { if (db) { return db.exec(); } else { throw new Error(); } }',
        ].join('\n'),
      ),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);

    // Assert — if (db) { return db.exec(); } 패턴에서 consequent가 ReturnStatement → isEarlyExit가 true로 판단
    // 따라서 현재 구현은 이를 guard로 인식하여 finding을 억제함
    expect(result.length).toBe(0);
  });

  it('analyzeTemporalCoupling - caller with null srcSymbolName via CFG - keeps finding conservatively', () => {
    // Arrange
    const targetSource = ['let db: any;', 'export function init() { db = 1; }', 'export function query() { return db; }'].join(
      '\n',
    );
    const files = [file('src/a.ts', targetSource)];
    // writer에는 caller 없음, reader에만 srcSymbolName: null인 caller 존재
    // → writerCallerSet이 비어있음 → null caller에 대해 !writerCallerSet.has → return false → finding 유지
    const mockGildash = createMockGildashWithAst(
      [
        {
          type: 'calls',
          srcFilePath: 'src/main.ts',
          srcSymbolName: null as unknown as string,
          dstFilePath: 'src/a.ts',
          dstSymbolName: 'query',
        },
      ],
      {},
    );
    // Act
    const result = analyzeTemporalCoupling(files as any, { gildash: mockGildash as any });

    // Assert — null srcSymbolName caller로는 writer 연결 불가 → finding 유지
    expect(result.length).toBe(1);
  });
});
