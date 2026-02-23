import { describe, expect, it } from 'bun:test';

import type { ParsedFile } from '../../engine/types';

import { parseSource } from '../../engine/ast/parse-source';
import { analyzeForwarding } from './analyzer';

const createProgram = (filePath: string, sourceText: string): ParsedFile[] => {
  return [parseSource(filePath, sourceText)];
};

const findKinds = (findings: ReturnType<typeof analyzeForwarding>, kind: string) => {
  return findings.filter(finding => finding.kind === kind);
};

describe('analyzer', () => {
  it('should report a thin wrapper when a function only forwards a call', () => {
    // Arrange
    const source = [
      'function target(value) {',
      '  return value + 1;',
      '}',
      'function wrapper(value) {',
      '  return target(value);',
      '}',
    ].join('\n');
    const program = createProgram('/virtual/forwarding.ts', source);
    // Act
    const analysis = analyzeForwarding(program, 0);
    const thinWrappers = findKinds(analysis, 'thin-wrapper');

    // Assert
    expect(thinWrappers.length).toBe(1);
    expect(thinWrappers[0]?.header).toBe('wrapper');
  });

  it('should ignore wrappers when arguments are transformed', () => {
    // Arrange
    const source = [
      'function target(value) {',
      '  return value + 1;',
      '}',
      'function wrapper(value) {',
      '  return target(value + 1);',
      '}',
    ].join('\n');
    const program = createProgram('/virtual/forwarding-transform.ts', source);
    // Act
    const analysis = analyzeForwarding(program, 0);
    const thinWrappers = findKinds(analysis, 'thin-wrapper');

    // Assert
    expect(thinWrappers.length).toBe(0);
  });

  it('should report chain depth when it exceeds the max', () => {
    // Arrange
    const source = [
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
    const program = createProgram('/virtual/forwarding-chain.ts', source);
    // Act
    const analysis = analyzeForwarding(program, 1);
    const chainFindings = findKinds(analysis, 'forward-chain');

    // Assert
    expect(chainFindings.length).toBe(1);
    expect(chainFindings[0]?.header).toBe('a');
  });

  it('should skip chain findings when depth stays within the max', () => {
    // Arrange
    const source = [
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
    const program = createProgram('/virtual/forwarding-depth.ts', source);
    // Act
    const analysis = analyzeForwarding(program, 2);
    const chainFindings = findKinds(analysis, 'forward-chain');

    // Assert
    expect(chainFindings.length).toBe(0);
  });
});
