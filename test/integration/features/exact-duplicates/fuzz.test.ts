import { describe, expect, it } from 'bun:test';

import { detectExactDuplicates } from '../../../../src/test-api';
import { createPrng, createProgramFromMap, getFuzzIterations, getFuzzSeed, toDuplicateSignatures } from '../../shared/test-kit';

const createArrowFunction = (exportName: string, literal: number): string => {
  return [`export const ${exportName} = () => {`, `  const value = ${literal};`, `  return value + 1;`, `};`].join('\n');
};

const createTypeAlias = (typeName: string, fieldName: string): string => {
  return `export type ${typeName} = { ${fieldName}: string };`;
};

const countDuplicateItems = (signature: string): number => {
  const items = signature.split(';').filter(item => item.length > 0);

  return items.length;
};

const hasMutantMixedGroup = (signature: string, mutantFile: string): boolean => {
  const items = signature.split(';').filter(item => item.length > 0);
  const hasMutant = items.some(item => item.startsWith(`${mutantFile}|`));
  const hasNonMutant = items.some(item => !item.startsWith(`${mutantFile}|`));

  return hasMutant && hasNonMutant;
};

describe('integration/exact-duplicates (fuzz)', () => {
  it('should detect duplicated structures when inputs are deterministic (seeded)', () => {
    // Arrange
    const seed = getFuzzSeed();
    const prng = createPrng(seed);
    const iterations = getFuzzIterations(200);

    // Act
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const sources = new Map<string, string>();
      const baseLiteral = prng.nextInt(10) + 1;
      const base = createArrowFunction(`base_${iteration}`, baseLiteral);
      const duplicateCount = 2 + prng.nextInt(3);

      for (let copy = 0; copy < duplicateCount; copy += 1) {
        const filePath = `/virtual/fuzz/dup-${seed}-${iteration}-${copy}.ts`;
        const fn = createArrowFunction(`fn_${iteration}_${copy}`, baseLiteral);
        const typeAlias = createTypeAlias(`T${iteration}_${copy}`, `field_${iteration}_${copy}`);

        // Ensure the file has at least one intentional duplicate plus some noise.
        sources.set(filePath, [fn, base, typeAlias].join('\n\n'));
      }

      // Add a near-duplicate: same shape but different literal.
      const mutantFile = `/virtual/fuzz/mutant-${seed}-${iteration}.ts`;
      const mutant = createArrowFunction(`mut_${iteration}`, baseLiteral + 1);

      sources.set(mutantFile, [mutant].join('\n'));

      const program = createProgramFromMap(sources);
      const first = toDuplicateSignatures(detectExactDuplicates(program, 1));
      const second = toDuplicateSignatures(detectExactDuplicates(program, 1));

      // Assert
      // Determinism: same input yields same normalized output.
      expect(second).toEqual(first);

      // Should detect at least one duplicate group (functions/types/nodes).
      const hasSomeGroup = first.some(signature => countDuplicateItems(signature) >= 2);

      expect(hasSomeGroup).toBe(true);

      // Literal mutation should not be grouped with the base.
      const mutantGrouped = first.some(signature => hasMutantMixedGroup(signature, mutantFile));

      expect(mutantGrouped).toBe(false);
    }
  });

  it('should respect minSize boundaries when functions are tiny', () => {
    // Arrange
    const sources = new Map<string, string>();

    sources.set('/virtual/fuzz/min-one.ts', createArrowFunction('alpha', 1));
    sources.set('/virtual/fuzz/min-two.ts', createArrowFunction('beta', 1));

    // Act
    const program = createProgramFromMap(sources);
    const lowThreshold = detectExactDuplicates(program, 1);
    const highThreshold = detectExactDuplicates(program, 500);

    // Assert
    expect(lowThreshold.length).toBeGreaterThan(0);
    expect(highThreshold.length).toBe(0);
  });
});
