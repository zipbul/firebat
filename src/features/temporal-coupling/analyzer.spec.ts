import type { CodeRelation, ParsedFile as GildashParsedFile } from '@zipbul/gildash';

import { GildashError } from '@zipbul/gildash';
import { describe, expect, it } from 'bun:test';

import { parsePFile as file, parsePFileWithErrors as fileWithErrors } from '../../../test/integration/shared/test-kit';
import { parseSource } from '../../engine/ast/parse-source';
import { analyzeTemporalCoupling, createEmptyTemporalCoupling } from './analyzer';

const singleFile = (sourceLines: string[]) => [file('src/a.ts', sourceLines.join('\n'))];

/** Analyze `files` and assert exactly `count` temporal-coupling findings. */
const expectTcCount = (
  files: ReadonlyArray<unknown>,
  count: number,
  options?: Parameters<typeof analyzeTemporalCoupling>[1],
): ReturnType<typeof analyzeTemporalCoupling> => {
  const result = analyzeTemporalCoupling(files as never, options as never);

  expect(result.length).toBe(count);

  return result;
};

/** Assert a finding's detected `state` name and `writers` count. */
const expectStateWriters = (
  finding: { state?: string; writers?: number } | undefined,
  state: string,
  writers: number,
): void => {
  expect(finding?.state).toBe(state);
  expect(finding?.writers).toBe(writers);
};

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

const createMockGildashWithAst = (relations: CodeRelation[], astMap: Record<string, GildashParsedFile>) => ({
  ...createMockGildash(relations),
  getParsedAst: (filePath: string): GildashParsedFile | undefined => astMap[filePath],
});

// getSymbolsByFile mock returning init/query as exported function symbols for src/a.ts.
const initQuerySymbolsForFileA = (filePath: string) => {
  if (filePath === 'src/a.ts') {
    return [
      { name: 'init', kind: 'function', isExported: true, filePath: 'src/a.ts' },
      { name: 'query', kind: 'function', isExported: true, filePath: 'src/a.ts' },
    ];
  }

  return [];
};

// init()/query() are the two callers wired up for every module-scope caller-AST
// scenario; only the caller body and the expected outcome vary per row.
const initQueryRelations: CodeRelation[] = [
  { type: 'calls', srcFilePath: 'src/main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'init' },
  { type: 'calls', srcFilePath: 'src/main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'query' },
];
const moduleTargetSource = ['let db: any;', 'export function init() { db = 1; }', 'export function query() { return db; }'].join(
  '\n',
);
// Module-scope writer/reader source lines reused across the relation-suppression table.
const moduleReaderSource = [
  'let db: any;',
  'export function init() { db = createDb(); }',
  'export function query() { return db; }',
];
const classTargetSource = [
  'export class Service {',
  '  x = 0;',
  '  init() { this.x = 1; }',
  '  query() { return this.x; }',
  '}',
].join('\n');

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
    expectTcCount(files, 0);
  });

  // --- [NE] should skip non-ts files ---
  it('should ignore non-ts files', () => {
    // Arrange
    const files = [file('src/a.js', 'let db = null; export function init() { db = 1; } export function query() { return db; }')];

    // Act
    expectTcCount(files, 0);
  });

  // --- [HP] should detect module-scope let with writer(=) and reader (canonical full shape) ---
  it('should report temporal coupling when a module-scope variable is written and read by different exported functions', () => {
    // Arrange
    const files = singleFile([
      'let db: number | null = null;',
      'export function initDb() { db = 1; }',
      'export function queryUsers() { return db; }',
    ]);
    // Act
    const result = expectTcCount(files, 1);

    expect(result[0]?.kind).toBe('temporal-coupling');
    expectStateWriters(result[0], 'db', 1);
    expect(result[0]?.readers).toBe(1);
  });

  // --- [HP] should detect module-scope let written via object destructuring (writers count) ---
  it('should report temporal coupling when a module-scope variable is written via object destructuring', () => {
    // Arrange — `({db} = create())` writes `db`; previously missed because the
    // AssignmentExpression.left is an ObjectPattern, not an Identifier, so the
    // identifier's start:end key never landed in writeKeys.
    const files = singleFile([
      'let db: any = null;',
      'export function initDb() { ({ db } = create()); }',
      'export function queryUsers() { return db; }',
      'declare function create(): { db: any };',
    ]);
    // Act
    const result = expectTcCount(files, 1);

    expectStateWriters(result[0], 'db', 1);
  });

  // --- [HP] writer/reader scenarios that vary only by source + detected state name ---
  it.each<[string, string[], string]>([
    [
      'a module-scope variable is written via array destructuring',
      [
        'let db: any = null;',
        'export function initDb() { [db] = create(); }',
        'export function queryUsers() { return db; }',
        'declare function create(): any[];',
      ],
      'db',
    ],
    [
      '+= assignment acts as a writer',
      ['let total = 0;', 'export function add(n: number) { total += n; }', 'export function getTotal() { return total; }'],
      'total',
    ],
    [
      '++ (UpdateExpression) acts as a writer',
      ['let count = 0;', 'export function increment() { count++; }', 'export function getCount() { return count; }'],
      'count',
    ],
    [
      'a class init/query pair has an unguarded reader',
      [
        'export class Service {',
        '  private initialized = false;',
        '  init() { this.initialized = true; }',
        '  query() { return this.initialized ? 1 : 0; }',
        '}',
      ],
      'initialized',
    ],
    [
      'an arrow-function export writes and reads the state',
      ['let x = 0;', 'export const init = () => { x = 1; };', 'export const query = () => x;'],
      'x',
    ],
    [
      'a function-expression export writes and reads the state',
      ['let x = 0;', 'export const init = function() { x = 1; };', 'export const query = function() { return x; };'],
      'x',
    ],
    [
      'a re-export pattern exposes writer and reader',
      ['let x = 0;', 'const init = () => { x = 1; };', 'const query = () => x;', 'export { init, query };'],
      'x',
    ],
  ])('should report temporal coupling with the expected state when %s', (_label, sourceLines, expectedState) => {
    // Arrange
    const files = singleFile(sourceLines);
    // Act
    const result = expectTcCount(files, 1);

    expect(result[0]?.state).toBe(expectedState);
  });

  // --- [HP] should emit one finding per reader when multiple readers exist ---
  it('should emit one finding per reader when one writer feeds multiple readers', () => {
    // Arrange
    const files = singleFile([
      'let conn: object | null = null;',
      'export function connect() { conn = {}; }',
      'export function q1() { return conn; }',
      'export function q2() { return conn; }',
      'export function q3() { return conn; }',
    ]);
    // Act
    const result = expectTcCount(files, 3);

    expect(result[0]?.writers).toBe(1);
    expect(result[0]?.readers).toBe(3);
  });

  // --- [HP] independent states detected within one file (states-contain shape) ---
  it.each<[string, string[], string[]]>([
    [
      'multiple module-scope let vars',
      [
        'let host = "";',
        'let port = 0;',
        'export function configure(h: string, p: number) { host = h; port = p; }',
        'export function getHost() { return host; }',
        'export function getPort() { return port; }',
      ],
      ['host', 'port'],
    ],
    [
      'a class with multiple state properties',
      [
        'export class Cache {',
        '  private ready = false;',
        '  private size = 0;',
        '  start() { this.ready = true; this.size = 100; }',
        '  isReady() { return this.ready; }',
        '  getSize() { return this.size; }',
        '}',
      ],
      ['ready', 'size'],
    ],
    [
      'a file mixing module-scope let and class state',
      [
        'let globalFlag = false;',
        'export function setGlobal() { globalFlag = true; }',
        'export function getGlobal() { return globalFlag; }',
        'export class Worker {',
        '  private active = false;',
        '  start() { this.active = true; }',
        '  isActive() { return this.active; }',
        '}',
      ],
      ['globalFlag', 'active'],
    ],
  ])('should detect independent states for %s', (_label, sourceLines, expectedStates) => {
    // Arrange
    const files = singleFile(sourceLines);
    // Act
    const result = analyzeTemporalCoupling(files as any);
    // Assert
    const states = result.map(r => r.state);

    expect(states).toEqual(expect.arrayContaining(expectedStates));
  });

  // --- [ID] should return identical results for same input ---
  it('should return identical results for same input when called twice', () => {
    // Arrange
    const files = singleFile([
      'let db: number | null = null;',
      'export function init() { db = 1; }',
      'export function get() { return db; }',
    ]);
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

  // --- AST-only (no gildash) scenarios that vary only by source + expected finding count ---
  it.each<[string, string[], number]>([
    // [NE] const declarations are not mutable state.
    ['const declarations are not reported', ['const data = [];', 'export function getData() { return data; }'], 0],
    // [NE] writer with no readers.
    [
      'only writers without readers are not reported',
      ['let x = 0;', 'export function set() { x = 1; }', 'export function a() { return 1; }'],
      0,
    ],
    // [NE] no exported functions.
    [
      'a file without exported functions is not reported',
      ['let x = 0;', 'function set() { x = 1; }', 'function get() { return x; }'],
      0,
    ],
    // [ED] let with no functions at all.
    ['a let with no functions in the file is not reported', ['let x = 0;'], 0],
    // [CO] keyword name without writer/reader split.
    [
      "a const named 'initialized' without a writer/reader split is not reported",
      ['const initialized = true;', 'export function check() { return initialized; }'],
      0,
    ],
    // B-1: default export writer with named reader.
    [
      'a default-export writer with a named reader is reported',
      ['let x = 0;', 'export default function init() { x = 1; }', 'export function query() { return x; }'],
      1,
    ],
    // B-2: class constructor as the only writer is not reported.
    [
      'a class constructor as the only writer is not reported',
      [
        'export class Counter {',
        '  count = 0;',
        '  constructor() { this.count = 0; }',
        '  getCount() { return this.count; }',
        '}',
      ],
      0,
    ],
    // B-2: constructor plus a method writer is reported for the method writer.
    [
      'a class constructor plus method writer is reported',
      [
        'export class Service {',
        '  x = 0;',
        '  constructor() { this.x = 0; }',
        '  set() { this.x = 1; }',
        '  get() { return this.x; }',
        '}',
      ],
      1,
    ],
    // B-3: UpdateExpression (this.x++ / --this.x) treated as a write.
    [
      'a class method writing via postfix ++ is reported',
      ['export class Counter {', '  count = 0;', '  inc() { this.count++; }', '  read() { return this.count; }', '}'],
      1,
    ],
    [
      'a class method writing via prefix -- is reported',
      ['export class Counter {', '  count = 0;', '  dec() { --this.count; }', '  read() { return this.count; }', '}'],
      1,
    ],
    // Phase 5: guard patterns.
    [
      'a reader with a throw guard is suppressed',
      [
        'let db: any;',
        'export function init() { db = createDb(); }',
        'export function query() { if (!db) throw new Error("not ready"); return db.exec(); }',
      ],
      0,
    ],
    [
      'a reader with a return guard is suppressed',
      [
        'let db: any;',
        'export function init() { db = createDb(); }',
        'export function query() { if (!db) return null; return db.exec(); }',
      ],
      0,
    ],
    [
      'a reader with no guard is reported',
      ['let db: any;', 'export function init() { db = createDb(); }', 'export function query() { return db.exec(); }'],
      1,
    ],
    [
      'a class reader with a this.x guard is suppressed',
      [
        'export class Service {',
        '  x: any = null;',
        '  init() { this.x = createX(); }',
        '  query() { if (!this.x) throw new Error(); return this.x.exec(); }',
        '}',
      ],
      0,
    ],
    [
      'a guard placed after the state access is reported',
      [
        'let db: any;',
        'export function init() { db = createDb(); }',
        'export function query() { db.exec(); if (!db) throw new Error(); }',
      ],
      1,
    ],
    [
      'a reader with a block-wrapped throw guard is suppressed',
      [
        'let db: any;',
        'export function init() { db = createDb(); }',
        "export function query() { if (!db) { throw new Error('not ready'); } return db.exec(); }",
      ],
      0,
    ],
    [
      'a reader whose if-branch returns (early-exit guard) is suppressed',
      [
        'let db: any;',
        'export function init() { db = createDb(); }',
        'export function query() { if (db) { return db.exec(); } else { throw new Error(); } }',
      ],
      0,
    ],
    // Phase 6: dead writer exclusion.
    [
      'a dead writer after return is excluded (no finding)',
      ['let db: any;', 'export function setup() { return; db = createDb(); }', 'export function query() { return db; }'],
      0,
    ],
    [
      'a dead writer after throw is excluded (no finding)',
      [
        'let db: any;',
        'export function setup() { throw new Error(); db = createDb(); }',
        'export function query() { return db; }',
      ],
      0,
    ],
    [
      'a class method dead writer after return is excluded (no finding)',
      [
        'export class Service {',
        '  x: any = null;',
        '  init() { return; this.x = createX(); }',
        '  query() { return this.x; }',
        '}',
      ],
      0,
    ],
    [
      'a reachable writer inside a conditional is kept',
      ['let db: any;', 'export function setup() { if (cond) { db = createDb(); } }', 'export function query() { return db; }'],
      1,
    ],
    [
      'a reachable writer is kept',
      ['let db: any;', 'export function setup() { db = createDb(); }', 'export function query() { return db; }'],
      1,
    ],
    // var declaration is treated as mutable state.
    [
      'a var declaration writer/reader is reported',
      ['var db: any;', 'export function init() { db = createDb(); }', 'export function query() { return db; }'],
      1,
    ],
    // A function that both writes and reads is not a pure reader.
    [
      'a function that writes and reads the same var is not counted as a pure reader',
      [
        'let count = 0;',
        'export function increment() { count += 1; }',
        'export function getAndReset() { const v = count; count = 0; return v; }',
      ],
      0,
    ],
    // Multiple writers for the same variable still report.
    [
      'multiple writers for the same variable are reported',
      [
        'let db: any;',
        'export function initA() { db = createA(); }',
        'export function initB() { db = createB(); }',
        'export function query() { return db; }',
      ],
      1,
    ],
  ])('should report %i finding(s) when %s', (_label, sourceLines, expectedLength) => {
    // Arrange
    const files = singleFile(sourceLines);
    // Act
    const result = analyzeTemporalCoupling(files as any);

    // Assert
    expect(result.length).toBe(expectedLength);
  });

  it('analyzeTemporalCoupling - reader has multiple guards for different checks - suppresses finding', () => {
    // Arrange — db 변수에 대한 guard가 존재
    const files = singleFile([
      'let db: any;',
      'let config: any;',
      'export function init() { db = createDb(); config = loadConfig(); }',
      'export function query() { if (!db) throw new Error(); if (!config) throw new Error(); return db.exec(config); }',
    ]);
    // Act
    const result = analyzeTemporalCoupling(files as any);
    // Assert — db에 대한 guard가 db 접근을 dominate → db finding 없음
    const dbFindings = result.filter(r => r.state === 'db');

    expect(dbFindings.length).toBe(0);
  });

  // --- gildash getSymbolsByFile 기반 exported name 수집 ---

  // gildash getSymbolsByFile reports init/query as exported → temporal coupling detected,
  // whether they are `export function` declarations or named via `export { ... }`.
  it.each<[string, string[]]>([
    [
      'exported function declarations',
      ['let db: any;', 'export function init() { db = createDb(); }', 'export function query() { return db; }'],
    ],
    [
      'export { init, query } specifiers',
      ['let db: any;', 'function init() { db = createDb(); }', 'function query() { return db; }', 'export { init, query };'],
    ],
  ])('should detect coupling when gildash getSymbolsByFile reports exported names via %s', (_label, sourceLines) => {
    // Arrange
    const files = singleFile(sourceLines);
    const mockGildash = {
      ...createMockGildash([]),
      getSymbolsByFile: initQuerySymbolsForFileA,
    };

    // Act
    expectTcCount(files, 1, { gildash: mockGildash as any });
  });

  it('analyzeTemporalCoupling - gildash getSymbolsByFile empty result - falls back to AST walk', () => {
    // Arrange — getSymbolsByFile returns empty → fallback to collectExportedFunctionNames
    const files = singleFile([
      'let db: any;',
      'export function init() { db = createDb(); }',
      'export function query() { return db; }',
    ]);
    const mockGildash = {
      ...createMockGildash([]),
      getSymbolsByFile: () => [],
    };

    // Act
    expectTcCount(files, 1, { gildash: mockGildash as any });
  });

  // --- caller-coexistence suppression via gildash relations: source + relations + outcome vary per row ---
  it.each<[string, string[], CodeRelation[], number]>([
    [
      'all callers of the module-scope reader also call the writer',
      moduleReaderSource,
      [
        { type: 'calls', srcFilePath: 'main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'init' },
        { type: 'calls', srcFilePath: 'main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'query' },
      ],
      0,
    ],
    [
      'some callers of the module-scope reader do not call the writer',
      moduleReaderSource,
      [{ type: 'calls', srcFilePath: 'main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'query' }],
      1,
    ],
    ['the module-scope reader has no callers at all', moduleReaderSource, [], 1],
    [
      'an intra-file caller calls both init and query',
      moduleReaderSource,
      [
        { type: 'calls', srcFilePath: 'src/a.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'init' },
        { type: 'calls', srcFilePath: 'src/a.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'query' },
      ],
      0,
    ],
    [
      'a class method whose only caller calls both init and query is suppressed',
      ['export class Service {', '  x = 0;', '  init() { this.x = 1; }', '  query() { return this.x; }', '}'],
      [
        { type: 'calls', srcFilePath: 'main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'Service.init' },
        { type: 'calls', srcFilePath: 'main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'Service.query' },
      ],
      0,
    ],
    [
      'a same-named writer in a different file does not satisfy the dstFilePath match',
      ['let db: any;', 'export function init() { db = 1; }', 'export function query() { return db; }'],
      // 'init' caller is pointing to 'src/other.ts', not 'src/a.ts'.
      [
        { type: 'calls', srcFilePath: 'main.ts', srcSymbolName: 'main', dstFilePath: 'src/other.ts', dstSymbolName: 'init' },
        { type: 'calls', srcFilePath: 'main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'query' },
      ],
      1,
    ],
    [
      'an anonymous class method cannot be matched by gildash so suppression is skipped',
      ['export const svc = new (class {', '  x = 0;', '  init() { this.x = 1; }', '  query() { return this.x; }', '})();'],
      // Gildash claims all callers call both, but the anonymous class cannot be matched.
      [
        { type: 'calls', srcFilePath: 'main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'init' },
        { type: 'calls', srcFilePath: 'main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'query' },
      ],
      1,
    ],
    [
      'two readers where one has no callers both report (queryB kept conservatively)',
      [
        'let db: any;',
        'export function init() { db = 1; }',
        'export function queryA() { return db; }',
        'export function queryB() { return db; }',
      ],
      // queryB has no caller relation.
      [
        { type: 'calls', srcFilePath: 'main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'init' },
        { type: 'calls', srcFilePath: 'main.ts', srcSymbolName: 'main', dstFilePath: 'src/a.ts', dstSymbolName: 'queryA' },
      ],
      2,
    ],
  ])('should report %#: %s', (_label, sourceLines, relations, expectedLength) => {
    // Arrange
    const files = singleFile(sourceLines);
    const mockGildash = createMockGildash(relations);
    // Act
    const result = analyzeTemporalCoupling(files as any, { gildash: mockGildash as any });

    // Assert
    expect(result.length).toBe(expectedLength);
  });

  // --- gildash searchRelations throws → AST-only fallback (module-scope and class) ---
  it.each<[string, string[]]>([
    [
      'a module-scope writer/reader',
      ['let db: any;', 'export function init() { db = createDb(); }', 'export function query() { return db; }'],
    ],
    [
      'a class writer/reader',
      ['export class Service {', '  x = 0;', '  init() { this.x = 1; }', '  query() { return this.x; }', '}'],
    ],
  ])('should fall back to AST-only and keep the finding when searchRelations throws for %s', (_label, sourceLines) => {
    // Arrange
    const files = singleFile(sourceLines);
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

  // --- Phase 3-4: caller AST 순서/CFG dominator 검사 (init/query callers, varying caller body) ---
  it.each<[string, string, number]>([
    // Phase 3: writer before reader (correct order) → suppression.
    ['the caller calls the writer before the reader', 'export function main() { init(); query(); }', 0],
    // Phase 3: reader before writer (reverse order) → kept.
    ['the caller calls the reader before the writer', 'export function main() { query(); init(); }', 1],
    // Phase 3: writer inside an if branch → conservatively kept.
    [
      'the caller calls the writer inside an if branch',
      'declare const needInit: boolean;\nexport function main() { if (needInit) { init(); } query(); }',
      1,
    ],
    // Phase 4: both if/else branches write → CFG dominates → suppression.
    [
      'both if/else branches of the caller call the writer',
      'declare const cond: boolean;\nexport function main() { if (cond) { init(); } else { init(); } query(); }',
      0,
    ],
    // Phase 4: single if branch writes → not dominating → kept.
    [
      'only a single if branch of the caller calls the writer',
      'declare const cond: boolean;\nexport function main() { if (cond) { init(); } query(); }',
      1,
    ],
    // Phase 4: try writer / catch then reader → exception edge → kept.
    ['the caller writes in try then reads after catch', 'export function main() { try { init(); } catch {} query(); }', 1],
    // Phase 4: writer and reader in the same try block → suppression.
    ['the caller writes and reads in the same try block', 'export function main() { try { init(); query(); } catch {} }', 0],
    // Phase 4: writer inside a loop (0 iterations possible) → kept.
    [
      'the caller calls the writer inside a loop',
      'declare const xs: any[];\nexport function main() { for (const x of xs) { init(); } query(); }',
      1,
    ],
    // Phase 4: writer inside a default-less switch case (conditional) → kept.
    [
      'the caller calls the writer inside a switch case',
      "declare const mode: string;\nexport function main() { switch(mode) { case 'a': init(); break; } query(); }",
      1,
    ],
    // Phase 4: writer inside a nested if → not dominating → kept.
    [
      'the caller calls the writer inside a nested if',
      'declare const a: boolean;\ndeclare const b: boolean;\nexport function main() { if (a) { if (b) { init(); } } query(); }',
      1,
    ],
  ])('should report %i finding(s) for the module-scope target when %s', (_label, callerBody, expectedLength) => {
    // Arrange
    const callerSource = ["import { init, query } from './a';", callerBody].join('\n');
    const callerParsed = parseSource('src/main.ts', callerSource);
    const files = [file('src/a.ts', moduleTargetSource)];
    const mockGildash = createMockGildashWithAst(initQueryRelations, {
      'src/main.ts': callerParsed as unknown as GildashParsedFile,
    });
    // Act
    const result = analyzeTemporalCoupling(files as any, { gildash: mockGildash as any });

    // Assert
    expect(result.length).toBe(expectedLength);
  });

  it('analyzeTemporalCoupling - getParsedAst returns undefined - keeps finding conservatively', () => {
    // Arrange
    const files = [file('src/a.ts', moduleTargetSource)];
    const mockGildash = createMockGildashWithAst(initQueryRelations, {}); // no entry for src/main.ts → getParsedAst returns undefined

    // Act
    expectTcCount(files, 1, { gildash: mockGildash as any });
  });

  it('analyzeTemporalCoupling - caller with null srcSymbolName via CFG - keeps finding conservatively', () => {
    // Arrange — writer에는 caller 없음, reader에만 srcSymbolName: null인 caller 존재
    // → writerCallerSet이 비어있음 → null caller에 대해 !writerCallerSet.has → return false → finding 유지
    const files = [file('src/a.ts', moduleTargetSource)];
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
    expectTcCount(files, 1, { gildash: mockGildash as any });
  });

  // --- class caller AST: writer before reader via getParsedAst → suppression ---
  it.each<[string, string, string, string]>([
    [
      'a method caller (App.run) invokes init before query',
      'src/app.ts',
      'App.run',
      [
        "import { Service } from './a';",
        'export class App {',
        '  run() { const s = new Service(); s.init(); s.query(); }',
        '}',
      ].join('\n'),
    ],
    [
      'a function caller (main) invokes init before query',
      'src/main.ts',
      'main',
      ["import { Service } from './a';", 'export function main() { const s = new Service(); s.init(); s.query(); }'].join('\n'),
    ],
  ])('should suppress the class finding when %s', (_label, callerFilePath, callerSymbol, callerSource) => {
    // Arrange
    const callerParsed = parseSource(callerFilePath, callerSource);
    const files = [file('src/a.ts', classTargetSource)];
    const mockGildash = createMockGildashWithAst(
      [
        {
          type: 'calls',
          srcFilePath: callerFilePath,
          srcSymbolName: callerSymbol,
          dstFilePath: 'src/a.ts',
          dstSymbolName: 'Service.init',
        },
        {
          type: 'calls',
          srcFilePath: callerFilePath,
          srcSymbolName: callerSymbol,
          dstFilePath: 'src/a.ts',
          dstSymbolName: 'Service.query',
        },
      ],
      { [callerFilePath]: callerParsed as unknown as GildashParsedFile },
    );

    // Act
    expectTcCount(files, 0, { gildash: mockGildash as any });
  });
});
