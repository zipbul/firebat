import { describe, expect, it } from 'bun:test';

import { analyzeIndirection } from '../../../../../src/test-api';
import { createPrng, createProgramFromMap } from '../../../shared/test-kit';
import { buildMockGildashFromSources } from '../mock-gildash-helper';

describe('integration/indirection/cross-file (fuzz)', () => {
  it('should report a cross-file chain for every wrapper with depth >= 2 when a random chain is generated', async () => {
    // Arrange
    const rng = createPrng(1);
    const iterations = 25;

    for (let round = 0; round < iterations; round += 1) {
      const chainLength = 3 + rng.nextInt(7); // 3..9
      const sources = new Map<string, string>();
      // Reuse one baseDir across rounds so the gildash semantic layer
      // replaces in-memory files instead of accumulating per-round trees.
      const baseDir = `/virtual/indirection-cross-fuzz`;

      for (let index = 0; index < chainLength; index += 1) {
        const filePath = `${baseDir}/m${index}.ts`;
        const nextRel = `./m${index + 1}`;

        if (index === chainLength - 1) {
          sources.set(
            filePath,
            [
              'function realWork(value) {',
              '  return value + 1;',
              '}',
              `export const f${index} = (value) => realWork(value);`,
            ].join('\n'),
          );

          continue;
        }

        sources.set(
          filePath,
          [`import { f${index + 1} } from '${nextRel}';`, `export const f${index} = (value) => f${index + 1}(value);`].join('\n'),
        );
      }

      // Act
      const program = createProgramFromMap(sources);
      const gildash = buildMockGildashFromSources(sources);
      const findings = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');
      const crossFile = findings.filter(f => f.kind === 'cross-file-forwarding-chain');
      const headers = crossFile.map(f => f.header).sort((a, b) => a.localeCompare(b));

      // Assert — wrappers f0..f(L-1) each delegate; f(L-1)→realWork is terminal
      // (depth 1, below minDepth 2). f(L-2)..f0 have depth 2..L → L-1 reported.
      expect(crossFile.length).toBe(chainLength - 1);
      expect(headers[0]).toBe('f0');
      expect(headers[headers.length - 1]).toBe(`f${chainLength - 2}`);
      expect(crossFile.every(f => f.depth >= 2)).toBe(true);
    }
  });
});
