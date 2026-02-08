import { describe, expect, it } from 'bun:test';

import { detectWaste } from '../../../src/features/waste';
import { createProgramFromMap } from '../shared/test-kit';

interface WasteKindFinding {
  readonly kind: string;
}

function createDeadStoreSource(): string {
  return [
    'export function deadStore() {',
    '  let value = 1;',
    '  return 0;',
    '}',
  ].join('\n');
}

function createOverwriteSource(): string {
  return [
    'export function overwrite() {',
    '  let value;',
    '  value = 1;',
    '  value = 2;',
    '  return value;',
    '}',
  ].join('\n');
}

function createReadSource(): string {
  return [
    'export function readValue() {',
    '  let value = 1;',
    '  return value;',
    '}',
  ].join('\n');
}

function hasKind(findings: ReadonlyArray<WasteKindFinding>, kind: string): boolean {
  return findings.some(finding => finding.kind === kind);
}

describe('integration/waste', () => {
  it('should report dead-store when values are never read', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/waste/dead-store.ts', createDeadStoreSource());

    // Act
    let program = createProgramFromMap(sources);
    let findings = detectWaste(program);

    // Assert
    expect(hasKind(findings, 'dead-store')).toBe(true);
    let deadStore = findings.find(f => f.kind === 'dead-store');
    expect(deadStore?.message).toContain('assigned but never read');
  });

  it('should report dead-store-overwrite when writes are overwritten', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/waste/overwrite.ts', createOverwriteSource());

    // Act
    let program = createProgramFromMap(sources);
    let findings = detectWaste(program);

    // Assert
    expect(hasKind(findings, 'dead-store-overwrite')).toBe(true);
    let overwrite = findings.find(f => f.kind === 'dead-store-overwrite');
    expect(overwrite?.message).toContain('overwritten before being read');
  });

  it('should not report findings when values are read', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/waste/read.ts', createReadSource());

    // Act
    let program = createProgramFromMap(sources);
    let findings = detectWaste(program);

    // Assert
    expect(findings.length).toBe(0);
  });

  it('should return no findings when input is empty', () => {
    // Arrange
    let sources = new Map<string, string>();
    // Act
    let program = createProgramFromMap(sources);
    let findings = detectWaste(program);

    // Assert
    expect(findings.length).toBe(0);
  });
});
