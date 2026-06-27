import { describe, expect, it } from 'bun:test';

import { detectWaste } from '../../../../src/test-api';
import { createProgramFromMap, singleSourceMap, wasteFindingsOf } from '../../shared/test-kit';

interface WasteKindFinding {
  readonly kind: string;
}

interface KindCase {
  readonly title: string;
  readonly filePath: string;
  readonly source: string;
  readonly kind: string;
  readonly message: string;
}

function createDeadStoreSource(): string {
  // case 1: declaration initializer overwritten before read.
  return ['export function deadStore() {', '  let value = 1;', '  value = 2;', '  return value;', '}'].join('\n');
}

function createOverwriteSource(): string {
  return ['export function overwrite() {', '  let value;', '  value = 1;', '  value = 2;', '  return value;', '}'].join('\n');
}

function createReadSource(): string {
  return ['export function readValue() {', '  let value = 1;', '  return value;', '}'].join('\n');
}

function hasKind(findings: ReadonlyArray<WasteKindFinding>, kind: string): boolean {
  return findings.some(finding => finding.kind === kind);
}

const kindCases: KindCase[] = [
  {
    title: 'dead-store when values are never read',
    filePath: '/virtual/waste/dead-store.ts',
    source: createDeadStoreSource(),
    kind: 'dead-store',
    message: 'assigned but never read',
  },
  {
    title: 'dead-store-overwrite when writes are overwritten',
    filePath: '/virtual/waste/overwrite.ts',
    source: createOverwriteSource(),
    kind: 'dead-store-overwrite',
    message: 'overwritten before being read',
  },
];

/** Build a program from `sources` and assert waste detection reports nothing. */
const expectNoWasteFrom = (sources: Map<string, string>): void => {
  expect(detectWaste(createProgramFromMap(sources)).length).toBe(0);
};

describe('integration/waste', () => {
  it.each(kindCases)('should report $title', ({ filePath, source, kind, message }) => {
    // Arrange
    const sources = singleSourceMap(filePath, source);

    // Act
    let findings = wasteFindingsOf(sources);

    // Assert
    expect(hasKind(findings, kind)).toBe(true);

    let finding = findings.find(f => f.kind === kind);

    expect(finding?.message).toContain(message);
  });

  it('should not report findings when values are read', () => {
    // Arrange
    const sources = singleSourceMap('/virtual/waste/read.ts', createReadSource());

    // Act
    expectNoWasteFrom(sources);
  });

  it('should return no findings when input is empty', () => {
    // Arrange
    let sources = new Map<string, string>();

    // Act
    expectNoWasteFrom(sources);
  });
});
