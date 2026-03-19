import { describe, expect, it } from 'bun:test';

import { analyzeIndirection } from '../../../../../src/test-api';
import { createProgramFromMap } from '../../../shared/test-kit';
import { buildMockGildashFromSources } from '../mock-gildash-helper';

describe('integration/indirection/cross-file', () => {
  it('should report cross-file chain depth when wrappers forward across modules', async () => {
    // Arrange
    const sources = new Map<string, string>();

    sources.set(
      '/virtual/indirection-cross/a.ts',
      ["import * as b from './b';", 'export const f = (value) => b.g(value);'].join('\n'),
    );

    sources.set(
      '/virtual/indirection-cross/b.ts',
      ["import * as c from './c';", 'export const g = (value) => c.h(value);'].join('\n'),
    );

    sources.set(
      '/virtual/indirection-cross/c.ts',
      ['function realWork(value) {', '  return value + 1;', '}', 'export const h = (value) => realWork(value);'].join('\n'),
    );

    // Act
    const program = createProgramFromMap(sources);
    const gildash = buildMockGildashFromSources(sources);
    const findings = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');
    const crossFile = findings.filter(finding => finding.kind === 'cross-file-forwarding-chain');

    // Assert
    expect(crossFile.length).toBe(1);
    expect(crossFile[0]?.header).toBe('f');
    expect(crossFile[0]?.depth).toBe(2);
  });

  it('should resolve named imports when wrappers forward across modules', async () => {
    // Arrange
    const sources = new Map<string, string>();

    sources.set(
      '/virtual/indirection-cross-named/a.ts',
      ["import { g } from './b';", 'export function f(value) {', '  return g(value);', '}'].join('\n'),
    );

    sources.set(
      '/virtual/indirection-cross-named/b.ts',
      ["import { h } from './c';", 'export const g = (value) => h(value);'].join('\n'),
    );

    sources.set(
      '/virtual/indirection-cross-named/c.ts',
      ['function realWork(value) {', '  return value + 1;', '}', 'export const h = (value) => realWork(value);'].join('\n'),
    );

    // Act
    const program = createProgramFromMap(sources);
    const gildash = buildMockGildashFromSources(sources);
    const findings = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');
    const crossFile = findings.filter(finding => finding.kind === 'cross-file-forwarding-chain');

    // Assert
    expect(crossFile.length).toBe(1);
    expect(crossFile[0]?.header).toBe('f');
    expect(crossFile[0]?.depth).toBe(2);
  });

  it('should resolve aliased named imports when wrappers forward across modules', async () => {
    // Arrange
    const sources = new Map<string, string>();

    sources.set(
      '/virtual/indirection-cross-alias/a.ts',
      ["import { g as g2 } from './b';", 'export const f = (value) => g2(value);'].join('\n'),
    );

    sources.set(
      '/virtual/indirection-cross-alias/b.ts',
      ["import { h } from './c';", 'export const g = (value) => h(value);'].join('\n'),
    );

    sources.set(
      '/virtual/indirection-cross-alias/c.ts',
      ['function realWork(value) {', '  return value + 1;', '}', 'export const h = (value) => realWork(value);'].join('\n'),
    );

    // Act
    const program = createProgramFromMap(sources);
    const gildash = buildMockGildashFromSources(sources);
    const findings = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');
    const crossFile = findings.filter(finding => finding.kind === 'cross-file-forwarding-chain');

    // Assert
    expect(crossFile.length).toBe(1);
    expect(crossFile[0]?.header).toBe('f');
    expect(crossFile[0]?.depth).toBe(2);
  });

  it('should report intermediate wrappers when chain depth exceeds two', async () => {
    // Arrange
    const sources = new Map<string, string>();

    sources.set(
      '/virtual/indirection-cross-deep/a.ts',
      ["import * as b from './b';", 'export const f = (value) => b.g(value);'].join('\n'),
    );

    sources.set(
      '/virtual/indirection-cross-deep/b.ts',
      ["import * as c from './c';", 'export const g = (value) => c.h(value);'].join('\n'),
    );

    sources.set(
      '/virtual/indirection-cross-deep/c.ts',
      ["import { i } from './d';", 'export const h = (value) => i(value);'].join('\n'),
    );

    sources.set(
      '/virtual/indirection-cross-deep/d.ts',
      ['function realWork(value) {', '  return value + 1;', '}', 'export const i = (value) => realWork(value);'].join('\n'),
    );

    // Act
    const program = createProgramFromMap(sources);
    const gildash = buildMockGildashFromSources(sources);
    const findings = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');
    const crossFile = findings.filter(finding => finding.kind === 'cross-file-forwarding-chain');
    const headers = crossFile.map(f => f.header).sort((a, b) => a.localeCompare(b));

    // Assert
    expect(headers).toEqual(['f', 'g']);
    expect(crossFile.find(f => f.header === 'f')?.depth).toBe(3);
    expect(crossFile.find(f => f.header === 'g')?.depth).toBe(2);
  });

  it('should not report cross-file chain when import cannot be resolved', async () => {
    // Arrange
    const sources = new Map<string, string>();

    sources.set(
      '/virtual/indirection-cross-unresolved/a.ts',
      ["import { g } from './missing';", 'export const f = (value) => g(value);'].join('\n'),
    );

    // Act
    const program = createProgramFromMap(sources);
    const gildash = buildMockGildashFromSources(sources);
    const findings = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');
    const crossFile = findings.filter(finding => finding.kind === 'cross-file-forwarding-chain');

    // Assert
    expect(crossFile.length).toBe(0);
  });
});
