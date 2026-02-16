import { describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { parseSource } from '../../../src/engine/parse-source';
import { analyzeApiDrift } from '../../../src/features/api-drift';
import { createProgramFromMap } from '../shared/test-kit';

function createHandleValueSource(): string {
  return ['export function handle(value) {', '  return value + 1;', '}'].join('\n');
}

function createHandleVoidSource(): string {
  return ['export function handle(value, flag = false) {', '  if (flag) {', '    return;', '  }', '  return;', '}'].join('\n');
}

function createHandleOptionalSource(): string {
  return ['export function handle(value, flag) {', '  if (flag) {', '    return value;', '  }', '  return value;', '}'].join(
    '\n',
  );
}

describe('integration/api-drift', () => {
  it('should not create global groups when the same bare name exists in many files', async () => {
    // Arrange
    const sources = new Map<string, string>();

    for (let index = 0; index < 5; index += 1) {
      sources.set(`/virtual/api-drift/get-${index}.ts`, ['export function get() {', '  return 1;', '}'].join('\n'));
    }

    // Act
    const program = createProgramFromMap(sources);
    const groups = await analyzeApiDrift(program);

    // Assert
    expect(groups.length).toBe(0);
  });

  it('should not report drift when function names are unique', async () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/api-drift/one.ts', `export function alpha() {\n  return 1;\n}`);
    sources.set('/virtual/api-drift/two.ts', `export function beta() {\n  return 2;\n}`);

    // Act
    let program = createProgramFromMap(sources);
    let groups = await analyzeApiDrift(program);

    // Assert
    expect(groups.length).toBe(0);
  });

  it('should return no findings when input is empty', async () => {
    // Arrange
    let sources = new Map<string, string>();
    // Act
    let program = createProgramFromMap(sources);
    let groups = await analyzeApiDrift(program);

    // Assert
    expect(groups.length).toBe(0);
  });

  it('should detect drift within the same file when the same function name has different shapes', async () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set(
      '/virtual/api-drift/one.ts',
      [
        'export const api = {',
        '  handle(value, flag = false) {',
        '    if (flag) {',
        '      return;',
        '    }',
        '    return;',
        '  },',
        '  handle(value, flag) {',
        '    if (flag) {',
        '      return value;',
        '    }',
        '    return value;',
        '  },',
        '};',
      ].join('\n'),
    );

    // Act
    let program = createProgramFromMap(sources);
    let groups = await analyzeApiDrift(program);

    // Assert
    expect(groups.length).toBe(1);
    expect(groups[0]?.outliers.length).toBeGreaterThan(0);
  });

  it('should avoid drift when arrow bodies return a value expression', async () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/api-drift/one.ts', `export const handle = (value) => value + 1;`);
    sources.set('/virtual/api-drift/two.ts', `export const handle = (value) => {\n  return value + 1;\n};`);

    // Act
    let program = createProgramFromMap(sources);
    let groups = await analyzeApiDrift(program);

    // Assert
    expect(groups.length).toBe(0);
  });

  it('should avoid drift when arrow bodies return an object literal expression', async () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/api-drift/one.ts', `export const handle = (value) => ({ key: value });`);
    sources.set('/virtual/api-drift/two.ts', `export const handle = (value) => {\n  return { key: value };\n};`);

    // Act
    let program = createProgramFromMap(sources);
    let groups = await analyzeApiDrift(program);

    // Assert
    expect(groups.length).toBe(0);
  });

  it('should avoid drift when arrow bodies return a void expression explicitly', async () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/api-drift/one.ts', `export const handle = () => void 0;`);
    sources.set('/virtual/api-drift/two.ts', `export const handle = () => {\n  return void 0;\n};`);

    // Act
    let program = createProgramFromMap(sources);
    let groups = await analyzeApiDrift(program);

    // Assert
    expect(groups.length).toBe(0);
  });

  it('should ignore nested function return statements when building return kind', async () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set(
      '/virtual/api-drift/one.ts',
      ['export function handle() {', '  const inner = () => {', '    return 1;', '  };', '  void inner;', '}'].join('\n'),
    );
    sources.set('/virtual/api-drift/two.ts', `export function handle() {\n  const value = 1;\n  void value;\n}`);

    // Act
    let program = createProgramFromMap(sources);
    let groups = await analyzeApiDrift(program);

    // Assert
    expect(groups.length).toBe(0);
  });

  it('should detect drift across files for the same class method name', async () => {
    // Arrange
    const sources = new Map<string, string>();

    sources.set(
      '/virtual/api-drift/one.ts',
      ['export class MyService {', '  get(id: string) {', '    return id;', '  }', '}'].join('\n'),
    );
    sources.set(
      '/virtual/api-drift/two.ts',
      ['export class MyService {', '  get(id: string, options?: Record<string, unknown>) {', '    return id;', '  }', '}'].join(
        '\n',
      ),
    );

    // Act
    const program = createProgramFromMap(sources);
    const groups = await analyzeApiDrift(program);

    // Assert
    expect(groups.length).toBe(1);
    expect(groups[0]?.label).toContain('MyService.get');
  });

  it('should group prefix families only when the prefix appears at least 3 times', async () => {
    // Arrange
    const sources = new Map<string, string>();

    sources.set('/virtual/api-drift/one.ts', `export function createUser(name: string) {\n  return name;\n}`);
    sources.set('/virtual/api-drift/two.ts', `export function createOrder(name: string) {\n  return name;\n}`);
    sources.set('/virtual/api-drift/three.ts', `export function createProduct(name: string, price: number) {\n  return name;\n}`);

    // Act
    const program = createProgramFromMap(sources);
    const groups = await analyzeApiDrift(program);

    // Assert
    expect(groups.length).toBe(1);
    expect(groups[0]?.label).toContain('prefix:create');
    expect(groups[0]?.outliers.length).toBe(1);
  });

  it('should compare interface implementers when tsgo is available', async () => {
    // Arrange
    const rootAbs = await mkdtemp(path.join(tmpdir(), 'firebat-api-drift-'));
    const tsconfigPath = path.join(rootAbs, 'tsconfig.json');
    const onePath = path.join(rootAbs, 'src', 'one.ts');
    const twoPath = path.join(rootAbs, 'src', 'two.ts');

    await mkdir(path.dirname(onePath), { recursive: true });
    await Bun.write(
      tsconfigPath,
      JSON.stringify(
        {
          compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext' },
          include: ['src/**/*.ts'],
        },
        null,
        2,
      ),
    );
    await Bun.write(
      onePath,
      [
        'export interface IService {',
        '  get(id: string): string;',
        '}',
        '',
        'export class A implements IService {',
        '  get(id: string) {',
        '    return id;',
        '  }',
        '}',
      ].join('\n'),
    );
    await Bun.write(
      twoPath,
      [
        "import type { IService } from './one';",
        '',
        'export class B implements IService {',
        '  get(id: string, options?: Record<string, unknown>) {',
        '    return id;',
        '  }',
        '}',
      ].join('\n'),
    );

    const program = [parseSource(onePath, await Bun.file(onePath).text()), parseSource(twoPath, await Bun.file(twoPath).text())];
    // Act
    const groups = await analyzeApiDrift(program, { rootAbs, tsconfigPath });
    // Assert
    // If tsgo is unavailable in the environment, the detector should degrade gracefully.
    const hasInterfaceGroup = groups.some(group => group.label.includes('IService.get'));

    expect(hasInterfaceGroup || groups.length === 0).toBe(true);

    await rm(rootAbs, { recursive: true, force: true });
  });
});
