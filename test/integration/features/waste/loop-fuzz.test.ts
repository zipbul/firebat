import { describe, expect, it } from 'bun:test';

import { detectWaste } from '../../../../src/features/waste';
import { createPrng, createProgramFromMap, getFuzzIterations, getFuzzSeed, toWasteSignatures } from '../../shared/test-kit';

const createBreakThenRead = (functionName: string, literal: number): string => {
  return [
    `export function ${functionName}() {`,
    `  let value = 0;`,
    `  while (true) {`,
    `    value = ${literal};`,
    `    break;`,
    `  }`,
    `  return value;`,
    `}`,
  ].join('\n');
};

const createBreakThenNoRead = (functionName: string, literal: number): string => {
  return [
    `export function ${functionName}() {`,
    `  let value = 0;`,
    `  while (true) {`,
    `    value = ${literal};`,
    `    break;`,
    `  }`,
    `  return 0;`,
    `}`,
  ].join('\n');
};

const getLoopGenerator = (shouldRead: boolean) => {
  const generators = [createBreakThenNoRead, createBreakThenRead];
  const generator = generators[Number(shouldRead)];

  if (generator === undefined) {
    throw new Error('Expected generator for loop case');
  }

  return generator;
};

describe('waste (integration fuzz)', () => {
  it('should report dead-store only when a loop breaks without reading the value (seeded)', () => {
    // Arrange
    const seed = getFuzzSeed();
    const prng = createPrng(seed);
    const iterations = getFuzzIterations(140);

    // Act
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const literal = prng.nextInt(10) + 1;
      const shouldRead = prng.nextBool();
      const filePath = `/virtual/fuzz/loop-${seed}-${iteration}.ts`;
      const sources = new Map<string, string>();
      const generator = getLoopGenerator(shouldRead);

      sources.set(filePath, generator(`loop${iteration}`, literal));

      const program = createProgramFromMap(sources);
      const signatures = toWasteSignatures(detectWaste(program));
      const hasDeadStore = signatures.some(signature => signature.includes(`${filePath}|dead-store|value`));

      // Assert
      expect(hasDeadStore).toBe(!shouldRead);

      const signaturesAgain = toWasteSignatures(detectWaste(program));

      expect(signaturesAgain).toEqual(signatures);
    }
  });
});
