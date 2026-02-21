import { describe, expect, it } from 'bun:test';

import { detectWaste } from '../../../../src/features/waste';
import { createPrng, createProgramFromMap, getFuzzIterations, getFuzzSeed, toWasteSignatures } from '../../shared/test-kit';

const createOverwriteChain = (functionName: string, literals: readonly number[]): string => {
  const lines: string[] = [`export function ${functionName}() {`, `  let value = ${literals[0] ?? 0};`];

  for (let index = 1; index < literals.length; index += 1) {
    lines.push(`  value = ${literals[index]};`);
  }

  lines.push('  return value;');
  lines.push('}');

  return lines.join('\n');
};

describe('waste (integration fuzz)', () => {
  it('should report dead-store-overwrite when the final value is returned (seeded)', () => {
    // Arrange
    const seed = getFuzzSeed();
    const prng = createPrng(seed);
    const iterations = getFuzzIterations(140);

    // Act
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const chainLength = 3 + prng.nextInt(3);
      const literals: number[] = [];

      for (let index = 0; index < chainLength; index += 1) {
        literals.push(prng.nextInt(100) + 1);
      }

      const filePath = `/virtual/fuzz/overwrite-${seed}-${iteration}.ts`;
      const sources = new Map<string, string>();

      sources.set(filePath, createOverwriteChain(`overwrite_${iteration}`, literals));

      const program = createProgramFromMap(sources);
      const signatures = toWasteSignatures(detectWaste(program));
      const hasOverwrite = signatures.some(signature => signature.includes(`${filePath}|dead-store-overwrite|value`));

      // Assert
      expect(hasOverwrite).toBe(true);

      const signaturesAgain = toWasteSignatures(detectWaste(program));

      expect(signaturesAgain).toEqual(signatures);
    }
  });
});
