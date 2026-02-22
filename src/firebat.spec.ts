import { mock, afterAll, describe, it, expect } from 'bun:test';
import * as nodePath from 'node:path';

const __origCliEntry = { ...require(nodePath.resolve(import.meta.dir, './adapters/cli/entry.ts')) };

mock.module(nodePath.resolve(import.meta.dir, './adapters/cli/entry.ts'), () => ({
  runCli: async (_argv: string[]) => 0,
}));

import { runFirebat } from './firebat';

describe('runFirebat', () => {
  it('should be a function', () => {
    expect(typeof runFirebat).toBe('function');
  });
});

afterAll(() => {
  mock.restore();
  mock.module(nodePath.resolve(import.meta.dir, './adapters/cli/entry.ts'), () => __origCliEntry);
});
