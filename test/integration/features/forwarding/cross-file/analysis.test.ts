import { describe, expect, it } from 'bun:test';

import { analyzeForwarding } from '../../../../../src/test-api';
import { createProgramFromMap } from '../../../shared/test-kit';
import { buildMockGildashFromSources } from '../mock-gildash-helper';

describe('integration/forwarding/cross-file', () => {
  it('should report cross-file chain depth when wrappers forward across modules', async () => {
    // Arrange
    const sources = new Map<string, string>();

    sources.set(
      '/virtual/forwarding-cross/a.ts',
      ["import * as b from './b';", 'export const f = (value) => b.g(value);'].join('\n'),
    );

    sources.set(
      '/virtual/forwarding-cross/b.ts',
      ["import * as c from './c';", 'export const g = (value) => c.h(value);'].join('\n'),
    );

    sources.set(
      '/virtual/forwarding-cross/c.ts',
      ['function realWork(value) {', '  return value + 1;', '}', 'export const h = (value) => realWork(value);'].join('\n'),
    );

    // Act
    const program = createProgramFromMap(sources);
    const gildash = buildMockGildashFromSources(sources);
    const findings = await analyzeForwarding(gildash, program, 0, '/virtual');
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
      '/virtual/forwarding-cross-named/a.ts',
      ["import { g } from './b';", 'export function f(value) {', '  return g(value);', '}'].join('\n'),
    );

    sources.set(
      '/virtual/forwarding-cross-named/b.ts',
      ["import { h } from './c';", 'export const g = (value) => h(value);'].join('\n'),
    );

    sources.set(
      '/virtual/forwarding-cross-named/c.ts',
      ['function realWork(value) {', '  return value + 1;', '}', 'export const h = (value) => realWork(value);'].join('\n'),
    );

    // Act
    const program = createProgramFromMap(sources);
    const gildash = buildMockGildashFromSources(sources);
    const findings = await analyzeForwarding(gildash, program, 0, '/virtual');
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
      '/virtual/forwarding-cross-alias/a.ts',
      ["import { g as g2 } from './b';", 'export const f = (value) => g2(value);'].join('\n'),
    );

    sources.set(
      '/virtual/forwarding-cross-alias/b.ts',
      ["import { h } from './c';", 'export const g = (value) => h(value);'].join('\n'),
    );

    sources.set(
      '/virtual/forwarding-cross-alias/c.ts',
      ['function realWork(value) {', '  return value + 1;', '}', 'export const h = (value) => realWork(value);'].join('\n'),
    );

    // Act
    const program = createProgramFromMap(sources);
    const gildash = buildMockGildashFromSources(sources);
    const findings = await analyzeForwarding(gildash, program, 0, '/virtual');
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
      '/virtual/forwarding-cross-deep/a.ts',
      ["import * as b from './b';", 'export const f = (value) => b.g(value);'].join('\n'),
    );

    sources.set(
      '/virtual/forwarding-cross-deep/b.ts',
      ["import * as c from './c';", 'export const g = (value) => c.h(value);'].join('\n'),
    );

    sources.set(
      '/virtual/forwarding-cross-deep/c.ts',
      ["import { i } from './d';", 'export const h = (value) => i(value);'].join('\n'),
    );

    sources.set(
      '/virtual/forwarding-cross-deep/d.ts',
      ['function realWork(value) {', '  return value + 1;', '}', 'export const i = (value) => realWork(value);'].join('\n'),
    );

    // Act
    const program = createProgramFromMap(sources);
    const gildash = buildMockGildashFromSources(sources);
    const findings = await analyzeForwarding(gildash, program, 0, '/virtual');
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
      '/virtual/forwarding-cross-unresolved/a.ts',
      ["import { g } from './missing';", 'export const f = (value) => g(value);'].join('\n'),
    );

    // Act
    const program = createProgramFromMap(sources);
    const gildash = buildMockGildashFromSources(sources);
    const findings = await analyzeForwarding(gildash, program, 0, '/virtual');
    const crossFile = findings.filter(finding => finding.kind === 'cross-file-forwarding-chain');

    // Assert
    expect(crossFile.length).toBe(0);
  });
});
