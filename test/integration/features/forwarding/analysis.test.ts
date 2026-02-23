import { describe, expect, it } from 'bun:test';

import { analyzeForwarding } from '../../../../src/test-api';
import { createProgramFromMap } from '../../shared/test-kit';

const createForwardingSource = (): string => {
  return [
    'function target(value) {',
    '  return value + 1;',
    '}',
    'function wrapper(value) {',
    '  return target(value);',
    '}',
  ].join('\n');
};

const createForwardingChainSource = (): string => {
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

describe('integration/forwarding', () => {
  it('should report thin wrappers when they only forward arguments', () => {
    // Arrange
    const sources = new Map<string, string>();

    sources.set('/virtual/forwarding/forward.ts', createForwardingSource());

    // Act
    const program = createProgramFromMap(sources);
    const findings = analyzeForwarding(program, 0);
    const thinWrappers = findings.filter(finding => finding.kind === 'thin-wrapper');

    // Assert
    expect(thinWrappers.length).toBe(1);
    expect(thinWrappers[0]?.header).toBe('wrapper');
  });

  it('should report thin wrappers when destructured params are forwarded', () => {
    // Arrange
    const sources = new Map<string, string>();
    const source = [
      'function target(a, b) {',
      '  return a + b;',
      '}',
      'export function wrapper({ a, b }) {',
      '  return target(a, b);',
      '}',
    ].join('\n');

    sources.set('/virtual/forwarding/object-pattern.ts', source);

    // Act
    const program = createProgramFromMap(sources);
    const findings = analyzeForwarding(program, 0);
    const thinWrappers = findings.filter(finding => finding.kind === 'thin-wrapper');

    // Assert
    expect(thinWrappers.some(f => f.header === 'wrapper')).toBe(true);
  });

  it('should report thin wrappers when destructured rest params are forwarded', () => {
    // Arrange
    const sources = new Map<string, string>();
    const source = [
      'function target(a, ...rest) {',
      '  return [a, ...rest].length;',
      '}',
      'export function wrapper({ a, ...rest }) {',
      '  return target(a, ...rest);',
      '}',
    ].join('\n');

    sources.set('/virtual/forwarding/object-pattern-rest.ts', source);

    // Act
    const program = createProgramFromMap(sources);
    const findings = analyzeForwarding(program, 0);
    const thinWrappers = findings.filter(finding => finding.kind === 'thin-wrapper');

    // Assert
    expect(thinWrappers.some(f => f.header === 'wrapper')).toBe(true);
  });

  it('should report chain depth when it exceeds max', () => {
    // Arrange
    const sources = new Map<string, string>();

    sources.set('/virtual/forwarding/chain.ts', createForwardingChainSource());

    // Act
    const program = createProgramFromMap(sources);
    const findings = analyzeForwarding(program, 1);
    const chainFindings = findings.filter(finding => finding.kind === 'forward-chain');

    // Assert
    expect(chainFindings.length).toBe(1);
    expect(chainFindings[0]?.header).toBe('a');
  });
});
