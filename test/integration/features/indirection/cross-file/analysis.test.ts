import { describe, expect, it } from 'bun:test';

import { analyzeIndirectionReal } from '../real-gildash';

describe('integration/indirection/cross-file', () => {
  interface CrossFileChainCase {
    name: string;
    files: Array<[string, string[]]>;
  }

  const crossFileChainCases: CrossFileChainCase[] = [
    {
      name: 'report cross-file chain depth when wrappers forward across modules',
      files: [
        ['/virtual/indirection-cross/a.ts', ["import { g } from './b';", 'export const f = (value) => g(value);']],
        ['/virtual/indirection-cross/b.ts', ["import { h } from './c';", 'export const g = (value) => h(value);']],
        [
          '/virtual/indirection-cross/c.ts',
          ['function realWork(value) {', '  return value + 1;', '}', 'export const h = (value) => realWork(value);'],
        ],
      ],
    },
    {
      name: 'resolve named imports when wrappers forward across modules',
      files: [
        [
          '/virtual/indirection-cross-named/a.ts',
          ["import { g } from './b';", 'export function f(value) {', '  return g(value);', '}'],
        ],
        ['/virtual/indirection-cross-named/b.ts', ["import { h } from './c';", 'export const g = (value) => h(value);']],
        [
          '/virtual/indirection-cross-named/c.ts',
          ['function realWork(value) {', '  return value + 1;', '}', 'export const h = (value) => realWork(value);'],
        ],
      ],
    },
    {
      name: 'resolve aliased named imports when wrappers forward across modules',
      files: [
        ['/virtual/indirection-cross-alias/a.ts', ["import { g as g2 } from './b';", 'export const f = (value) => g2(value);']],
        ['/virtual/indirection-cross-alias/b.ts', ["import { h } from './c';", 'export const g = (value) => h(value);']],
        [
          '/virtual/indirection-cross-alias/c.ts',
          ['function realWork(value) {', '  return value + 1;', '}', 'export const h = (value) => realWork(value);'],
        ],
      ],
    },
  ];

  it.each(crossFileChainCases)('should $name', async ({ files }) => {
    // Arrange
    const sources = new Map<string, string>();

    files.forEach(([path, lines]) => sources.set(path, lines.join('\n')));

    // Act
    const findings = await analyzeIndirectionReal(sources, { maxForwardDepth: 0, crossFileMinDepth: 2 });
    const crossFile = findings.filter(finding => finding.kind === 'cross-file-forwarding-chain');
    const headers = crossFile.map(c => c.header).sort((a, b) => a.localeCompare(b));

    // Assert — wrappers f→g→h delegate (h→realWork is terminal). Each delegating
    // function counts: h.depth=1, g.depth=2, f.depth=3. At minDepth 2, f and g report.
    expect(headers).toEqual(['f', 'g']);
    expect(crossFile.find(c => c.header === 'f')?.depth).toBe(3);
    expect(crossFile.find(c => c.header === 'g')?.depth).toBe(2);
  });

  it('should report intermediate wrappers when chain depth exceeds two', async () => {
    // Arrange
    const sources = new Map<string, string>();

    sources.set(
      '/virtual/indirection-cross-deep/a.ts',
      ["import { g } from './b';", 'export const f = (value) => g(value);'].join('\n'),
    );

    sources.set(
      '/virtual/indirection-cross-deep/b.ts',
      ["import { h } from './c';", 'export const g = (value) => h(value);'].join('\n'),
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
    const findings = await analyzeIndirectionReal(sources, { maxForwardDepth: 0, crossFileMinDepth: 2 });
    const crossFile = findings.filter(finding => finding.kind === 'cross-file-forwarding-chain');
    const headers = crossFile.map(f => f.header).sort((a, b) => a.localeCompare(b));

    // Assert — wrappers f→g→h→i delegate (i→realWork terminal). i.depth=1,
    // h.depth=2, g.depth=3, f.depth=4. At minDepth 2: f, g, h report (i below floor).
    expect(headers).toEqual(['f', 'g', 'h']);
    expect(crossFile.find(f => f.header === 'f')?.depth).toBe(4);
    expect(crossFile.find(f => f.header === 'g')?.depth).toBe(3);
    expect(crossFile.find(f => f.header === 'h')?.depth).toBe(2);
  });

  it('should not report cross-file chain when import cannot be resolved', async () => {
    // Arrange
    const sources = new Map<string, string>();

    sources.set(
      '/virtual/indirection-cross-unresolved/a.ts',
      ["import { g } from './missing';", 'export const f = (value) => g(value);'].join('\n'),
    );

    // Act
    const findings = await analyzeIndirectionReal(sources, { maxForwardDepth: 0, crossFileMinDepth: 2 });
    const crossFile = findings.filter(finding => finding.kind === 'cross-file-forwarding-chain');

    // Assert
    expect(crossFile.length).toBe(0);
  });

  it('should report a cross-file circular chain with depth -1 and circular evidence', async () => {
    // Arrange — a.f → b.g → a.f forms an import-graph cycle.
    const sources = new Map<string, string>();

    sources.set(
      '/virtual/indirection-cross-cycle/a.ts',
      ["import { g } from './b';", 'export const f = (value) => g(value);'].join('\n'),
    );
    sources.set(
      '/virtual/indirection-cross-cycle/b.ts',
      ["import { f } from './a';", 'export const g = (value) => f(value);'].join('\n'),
    );

    // Act
    const findings = await analyzeIndirectionReal(sources, { maxForwardDepth: 0, crossFileMinDepth: 2 });
    const crossFile = findings.filter(finding => finding.kind === 'cross-file-forwarding-chain');

    // Assert — both nodes in the cycle reported as depth -1.
    expect(crossFile.length).toBe(2);
    expect(crossFile.every(f => f.depth === -1)).toBe(true);
    expect(crossFile.every(f => f.evidence.includes('circular'))).toBe(true);
  });
});
