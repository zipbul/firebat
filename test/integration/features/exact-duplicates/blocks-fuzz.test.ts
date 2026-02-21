import { describe, expect, it } from 'bun:test';

import { detectExactDuplicates } from '../../../../src/features/exact-duplicates';
import { createPrng, createProgramFromMap, getFuzzIterations, getFuzzSeed } from '../../shared/test-kit';

const createBlockPairSource = (firstName: string, secondName: string, literal: number): string => {
  return [
    `export const ${firstName} = () => {`,
    `  if (true) {`,
    `    const value = ${literal};`,
    `    console.log(value);`,
    `  }`,
    `};`,
    `export const ${secondName} = () => {`,
    `  if (true) {`,
    `    const value = ${literal};`,
    `    console.log(value);`,
    `  }`,
    `};`,
  ].join('\n');
};

const hasBlockDuplicateGroup = (groups: ReturnType<typeof detectExactDuplicates>): boolean => {
  return groups.some(group => group.items.some(item => item.kind === 'node'));
};

describe('exact-duplicates (integration fuzz)', () => {
  it('should not target BlockStatement while remaining deterministic (seeded)', () => {
    // Arrange
    const seed = getFuzzSeed();
    const prng = createPrng(seed);
    const iterations = getFuzzIterations(120);

    // Act
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const literal = prng.nextInt(10) + 1;
      const filePath = `/virtual/fuzz/blocks-${seed}-${iteration}.ts`;
      const sources = new Map<string, string>();

      sources.set(filePath, createBlockPairSource(`first_${iteration}`, `second_${iteration}`, literal));

      const program = createProgramFromMap(sources);
      const groups = detectExactDuplicates(program, 1);
      const hasBlockDuplicate = hasBlockDuplicateGroup(groups);
      const hasSomeDuplicate = groups.some(group => group.items.length >= 2);

      // Assert
      expect(hasSomeDuplicate).toBe(true);
      expect(hasBlockDuplicate).toBe(false);

      const groupsAgain = detectExactDuplicates(program, 1);

      expect(groupsAgain).toEqual(groups);
    }
  });
});
