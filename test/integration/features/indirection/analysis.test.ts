import { describe, expect, it } from 'bun:test';

import { analyzeIndirection } from '../../../../src/test-api';
import { createProgramFromMap, singleSourceMap } from '../../shared/test-kit';
import { buildMockGildashFromSources } from './mock-gildash-helper';

const createIndirectionSource = (): string => {
  return [
    'function target(value) {',
    '  return value + 1;',
    '}',
    'function wrapper(value) {',
    '  return target(value);',
    '}',
  ].join('\n');
};

const createIndirectionChainSource = (): string => {
  return [
    'function c(value) {',
    '  return value;',
    '}',
    'function b(value) {',
    '  return c(value);',
    '}',
    'function a(value) {',
    '  return b(value);',
    '}',
  ].join('\n');
};

describe('integration/indirection', () => {
  it('should report thin wrappers when they only forward arguments', async () => {
    // Arrange
    const sources = singleSourceMap('/virtual/indirection/forward.ts', createIndirectionSource());
    // Act
    const program = createProgramFromMap(sources);
    const gildash = buildMockGildashFromSources(sources);
    const findings = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');
    const thinWrappers = findings.filter(finding => finding.kind === 'thin-wrapper');

    // Assert
    expect(thinWrappers.length).toBe(1);
    expect(thinWrappers[0]?.header).toBe('wrapper');
  });

  interface DestructuredForwardCase {
    name: string;
    path: string;
    source: string;
  }

  // Destructuring a pattern param and re-spreading its bindings is an object↔positional
  // transform (spec ①) → K. The wrapper must NOT be reported.
  const destructuredForwardCases: DestructuredForwardCase[] = [
    {
      name: 'destructured params are forwarded',
      path: '/virtual/indirection/object-pattern.ts',
      source: [
        'function target(a, b) {',
        '  return a + b;',
        '}',
        'function wrapper({ a, b }) {',
        '  return target(a, b);',
        '}',
        'wrapper({ a: 1, b: 2 });',
      ].join('\n'),
    },
    {
      name: 'destructured rest params are forwarded',
      path: '/virtual/indirection/object-pattern-rest.ts',
      source: [
        'function target(a, ...rest) {',
        '  return [a, ...rest].length;',
        '}',
        'function wrapper({ a, ...rest }) {',
        '  return target(a, ...rest);',
        '}',
        'wrapper({ a: 1 });',
      ].join('\n'),
    },
  ];

  it.each(destructuredForwardCases)('should NOT report thin wrappers when $name', async ({ path, source }) => {
    // Arrange
    const sources = singleSourceMap(path, source);
    // Act
    const program = createProgramFromMap(sources);
    const gildash = buildMockGildashFromSources(sources);
    const findings = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');
    const thinWrappers = findings.filter(finding => finding.kind === 'thin-wrapper');

    // Assert
    expect(thinWrappers.some(f => f.header === 'wrapper')).toBe(false);
  });

  it('should report chain depth when it exceeds max', async () => {
    // Arrange
    const sources = singleSourceMap('/virtual/indirection/chain.ts', createIndirectionChainSource());
    // Act
    const program = createProgramFromMap(sources);
    const gildash = buildMockGildashFromSources(sources);
    const findings = await analyzeIndirection(gildash, program, { maxForwardDepth: 1, crossFileMinDepth: 2 }, '/virtual');
    const chainFindings = findings.filter(finding => finding.kind === 'forward-chain');

    // Assert
    expect(chainFindings.length).toBe(1);
    expect(chainFindings[0]?.header).toBe('a');
  });
});
