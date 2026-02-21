import { describe, expect, it } from 'bun:test';

import { detectExactDuplicates } from '../../../../src/features/exact-duplicates';
import { createPrng, createProgramFromMap, getFuzzIterations, getFuzzSeed, toDuplicateSignatures } from '../../shared/test-kit';

const createDuplicateFunction = (exportName: string, literal: number): string => {
  return [`export const ${exportName} = () => {`, `  const value = ${literal};`, `  return value + 1;`, `};`].join('\n');
};

const createNoiseFunction = (exportName: string, literal: number): string => {
  return [`export const ${exportName} = () => {`, `  const noise = ${literal};`, `  return noise;`, `};`].join('\n');
};

const hasDuplicateGroup = (signatures: readonly string[]): boolean => {
  return signatures.some(signature => {
    const items = signature.split(';').filter(item => item.length > 0);

    return items.length >= 2;
  });
};

describe('exact-duplicates (integration fuzz)', () => {
  it('should remain stable when extra non-duplicate code is present (seeded)', () => {
    // Arrange
    const seed = getFuzzSeed();
    const prng = createPrng(seed);
    const iterations = getFuzzIterations(160);

    // Act
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const sources = new Map<string, string>();
      const literal = prng.nextInt(10) + 1;
      const dupA = createDuplicateFunction(`dupA_${iteration}`, literal);
      const dupB = createDuplicateFunction(`dupB_${iteration}`, literal);
      const noiseCount = 1 + prng.nextInt(3);
      const noiseParts: string[] = [];

      for (let noiseIndex = 0; noiseIndex < noiseCount; noiseIndex += 1) {
        noiseParts.push(createNoiseFunction(`noise_${iteration}_${noiseIndex}`, prng.nextInt(20) + 1));
      }

      const filePath = `/virtual/fuzz/noise-${seed}-${iteration}.ts`;

      sources.set(filePath, [dupA, dupB, ...noiseParts].join('\n\n'));

      const program = createProgramFromMap(sources);
      const first = toDuplicateSignatures(detectExactDuplicates(program, 1));
      const second = toDuplicateSignatures(detectExactDuplicates(program, 1));

      // Assert
      expect(second).toEqual(first);
      expect(hasDuplicateGroup(first)).toBe(true);
    }
  });
});
