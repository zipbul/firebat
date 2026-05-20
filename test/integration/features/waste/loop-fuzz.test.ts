import { describe, expect, it } from 'bun:test';

import { detectWaste } from '../../../../src/test-api';
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
  it('should report dead-store on the initializer iff the loop value is read after the loop (seeded)', () => {
    // CLAUDE.md case 1: `while(true) { value = ?; break; }` always runs once, so
    // `let value = 0` initializer is overwritten before the loop exit.
    //   - shouldRead=true  → `return value`: value is used, initializer is dead → dead-store
    //   - shouldRead=false → `return 0`: value is never read at all, falling under
    //     "사용처 0회 변수 (no-unused-vars 영역)" 비대상 → waste must NOT report it
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
      expect(hasDeadStore).toBe(shouldRead);

      const signaturesAgain = toWasteSignatures(detectWaste(program));

      expect(signaturesAgain).toEqual(signatures);
    }
  });
});
