import { describe, expect, it } from 'bun:test';

import { detectWaste } from '../../../../src/features/waste';
import { createProgramFromMap } from '../../shared/test-kit';

describe('integration/waste/memory-retention', () => {
  it('should report memory-retention when a variable is last used far before function end', () => {
    // Arrange
    let sources = new Map<string, string>();
    let source = [
      'export function retention() {',
      '  const hugeData = loadEntireDataset();',
      '  const summary = summarize(hugeData);',
      '  doWork1(summary);',
      '  doWork2(summary);',
      '  doWork3(summary);',
      '  doWork4(summary);',
      '  doWork5(summary);',
      '  doWork6(summary);',
      '  doWork7(summary);',
      '  doWork8(summary);',
      '  doWork9(summary);',
      '  doWork10(summary);',
      '  return summary;',
      '}',
    ].join('\n');

    sources.set('/virtual/waste/memory-retention.ts', source);

    // Act
    let program = createProgramFromMap(sources);
    let findings = detectWaste(program);
    let memoryRetentions = findings.filter(f => f.kind === 'memory-retention');

    // Assert
    expect(memoryRetentions.length).toBe(1);
    expect(memoryRetentions[0]?.label).toBe('hugeData');
    expect(memoryRetentions[0]?.confidence).toBe(0.5);
  });

  it('should not report memory-retention when the variable is last used near function end', () => {
    // Arrange
    let sources = new Map<string, string>();
    let source = [
      'export function noRetention() {',
      '  const hugeData = loadEntireDataset();',
      '  doWork1(hugeData);',
      '  doWork2(hugeData);',
      '  doWork3(hugeData);',
      '  return hugeData;',
      '}',
    ].join('\n');

    sources.set('/virtual/waste/memory-retention-near-end.ts', source);

    // Act
    let program = createProgramFromMap(sources);
    let findings = detectWaste(program);

    // Assert
    expect(findings.some(f => f.kind === 'memory-retention')).toBe(false);
  });

  it('should not report memory-retention when the variable is overwritten after its last read', () => {
    // Arrange
    let sources = new Map<string, string>();
    let source = [
      'export function overwriteReleases() {',
      '  let hugeData = loadEntireDataset();',
      '  const summary = summarize(hugeData);',
      '  hugeData = null;',
      '  doWork1(summary);',
      '  doWork2(summary);',
      '  doWork3(summary);',
      '  doWork4(summary);',
      '  doWork5(summary);',
      '  doWork6(summary);',
      '  doWork7(summary);',
      '  doWork8(summary);',
      '  doWork9(summary);',
      '  doWork10(summary);',
      '  return summary;',
      '}',
    ].join('\n');

    sources.set('/virtual/waste/memory-retention-overwrite.ts', source);

    // Act
    let program = createProgramFromMap(sources);
    let findings = detectWaste(program);

    // Assert
    expect(findings.some(f => f.kind === 'memory-retention')).toBe(false);
  });

  it('should respect a higher threshold when configured', () => {
    // Arrange
    let sources = new Map<string, string>();
    let source = [
      'export function retentionThreshold() {',
      '  const hugeData = loadEntireDataset();',
      '  const summary = summarize(hugeData);',
      '  doWork1(summary);',
      '  doWork2(summary);',
      '  doWork3(summary);',
      '  doWork4(summary);',
      '  doWork5(summary);',
      '  doWork6(summary);',
      '  doWork7(summary);',
      '  doWork8(summary);',
      '  doWork9(summary);',
      '  doWork10(summary);',
      '  return summary;',
      '}',
    ].join('\n');

    sources.set('/virtual/waste/memory-retention-threshold.ts', source);

    // Act
    let program = createProgramFromMap(sources);
    let findings = detectWaste(program, { memoryRetentionThreshold: 50 });

    // Assert
    expect(findings.some(f => f.kind === 'memory-retention')).toBe(false);
  });

  it('should report memory-retention when last use is far on both branches', () => {
    // Arrange
    let sources = new Map<string, string>();
    let source = [
      'export function retentionBranch(flag) {',
      '  const hugeData = loadEntireDataset();',
      '  const summary = summarize(hugeData);',
      '  if (flag) {',
      '    doWorkA(summary);',
      '  } else {',
      '    doWorkB(summary);',
      '  }',
      '  doWork1(summary);',
      '  doWork2(summary);',
      '  doWork3(summary);',
      '  doWork4(summary);',
      '  doWork5(summary);',
      '  doWork6(summary);',
      '  doWork7(summary);',
      '  doWork8(summary);',
      '  doWork9(summary);',
      '  doWork10(summary);',
      '  return summary;',
      '}',
    ].join('\n');

    sources.set('/virtual/waste/memory-retention-branch.ts', source);

    // Act
    let program = createProgramFromMap(sources);
    let findings = detectWaste(program);
    let memoryRetentions = findings.filter(f => f.kind === 'memory-retention');

    // Assert
    expect(memoryRetentions.length).toBe(1);
    expect(memoryRetentions[0]?.label).toBe('hugeData');
  });

  it('should not report memory-retention when a variable is read again near end', () => {
    // Arrange
    let sources = new Map<string, string>();
    let source = [
      'export function retentionReadAgain() {',
      '  const hugeData = loadEntireDataset();',
      '  const summary = summarize(hugeData);',
      '  doWork1(summary);',
      '  doWork2(summary);',
      '  doWork3(summary);',
      '  doWork4(summary);',
      '  doWork5(summary);',
      '  doWork6(summary);',
      '  doWork7(summary);',
      '  doWork8(summary);',
      '  doWork9(summary);',
      '  doWork10(summary);',
      '  doWorkNearEnd(hugeData);',
      '  return summary;',
      '}',
    ].join('\n');

    sources.set('/virtual/waste/memory-retention-read-again.ts', source);

    // Act
    let program = createProgramFromMap(sources);
    let findings = detectWaste(program);

    // Assert
    expect(findings.some(f => f.kind === 'memory-retention')).toBe(false);
  });

  it('should not report memory-retention for intentionally infinite loops', () => {
    // Arrange
    let sources = new Map<string, string>();
    let source = [
      'export function retentionInfiniteLoop() {',
      '  const hugeData = loadEntireDataset();',
      '  doWork1(hugeData);',
      '  while (true) {',
      '    doWorkLoop();',
      '  }',
      '}',
    ].join('\n');

    sources.set('/virtual/waste/memory-retention-infinite-loop.ts', source);

    // Act
    let program = createProgramFromMap(sources);
    let findings = detectWaste(program);

    // Assert
    expect(findings.some(f => f.kind === 'memory-retention')).toBe(false);
  });
});
