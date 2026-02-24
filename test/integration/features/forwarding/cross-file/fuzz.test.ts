import { describe, expect, it } from 'bun:test';

import { analyzeForwarding } from '../../../../../src/test-api';
import { createPrng, createProgramFromMap } from '../../../shared/test-kit';
import { buildMockGildashFromSources } from '../mock-gildash-helper';

describe('integration/forwarding/cross-file (fuzz)', () => {
  it('should report a cross-file chain for every wrapper with depth >= 2 when a random chain is generated', async () => {
    // Arrange
    const rng = createPrng(1);
    const iterations = 25;

    for (let round = 0; round < iterations; round += 1) {
      const chainLength = 3 + rng.nextInt(7); // 3..9
      const sources = new Map<string, string>();
      const baseDir = `/virtual/forwarding-cross-fuzz/${round}`;

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
          [`import * as next from '${nextRel}';`, `export const f${index} = (value) => next.f${index + 1}(value);`].join('\n'),
        );
      }

      // Act
      const program = createProgramFromMap(sources);
      const gildash = buildMockGildashFromSources(sources);
      const findings = await analyzeForwarding(gildash, program, 0, '/virtual');
      const crossFile = findings.filter(f => f.kind === 'cross-file-forwarding-chain');
      const headers = crossFile.map(f => f.header).sort((a, b) => a.localeCompare(b));

      // Assert
      expect(crossFile.length).toBe(chainLength - 2);
      expect(headers[0]).toBe('f0');
      expect(headers[headers.length - 1]).toBe(`f${chainLength - 3}`);
      expect(crossFile.every(f => f.depth >= 2)).toBe(true);
    }
  });
});
