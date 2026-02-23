import { describe, expect, it } from 'bun:test';

import type { ParsedFile } from '../../engine/types';
import type { DuplicateGroup } from '../../types';

import { parseSource } from '../../engine/ast/parse-source';
import { detectExactDuplicates } from './detector';

describe('detector', () => {
  it('should report at least one duplicate group when identical functions exist', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set(
      '/virtual/dup.ts',
      [
        'export const alpha = () => {',
        '  const value = 1;',
        '  return value + 1;',
        '};',
        'export const beta = () => {',
        '  const value = 1;',
        '  return value + 1;',
        '};',
      ].join('\n'),
    );

    let program = createProgram(sources);
    // Act
    let groups = detectExactDuplicates(program, 10);
    let functionGroup = findGroupByKind(groups, 'function');
    let functionGroupItems = getGroupItems(functionGroup);

    // Assert
    expect(groups.length).toBeGreaterThan(0);
    expect(functionGroup).not.toBeNull();
    expect(functionGroupItems.length).toBeGreaterThanOrEqual(2);
  });

  it('should report a duplicate group spanning files when the same structure appears across files', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/a.ts', ['export function alpha() {', '  const value = 1;', '  return value + 1;', '}'].join('\n'));

    sources.set('/virtual/b.ts', ['export function alpha() {', '  const value = 1;', '  return value + 1;', '}'].join('\n'));

    let program = createProgram(sources);
    // Act
    let groups = detectExactDuplicates(program, 10);
    let functionGroup = findGroupByKind(groups, 'function');
    let files = getGroupFilePaths(functionGroup);

    // Assert
    expect(functionGroup).not.toBeNull();
    expect(files.includes('/virtual/a.ts')).toBe(true);
    expect(files.includes('/virtual/b.ts')).toBe(true);
  });

  it('should not include BlockStatement items when duplicates exist', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set(
      '/virtual/blocks.ts',
      [
        'export const first = () => {',
        '  if (true) {',
        '    const value = 1;',
        '    console.log(value);',
        '  }',
        '};',
        'export const second = () => {',
        '  if (true) {',
        '    const value = 1;',
        '    console.log(value);',
        '  }',
        '};',
      ].join('\n'),
    );

    let program = createProgram(sources);
    // Act
    let groups = detectExactDuplicates(program, 10);
    const hasNodeKind = groups.some(group => group.items.some(item => item.kind === 'node'));
    const hasSomeGroup = groups.some(group => group.items.length >= 2);

    // Assert
    expect(hasSomeGroup).toBe(true);
    expect(hasNodeKind).toBe(false);
  });

  it('should report duplicate groups for type shapes when identical type aliases and interfaces exist', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set(
      '/virtual/types-a.ts',
      ['export type Alpha = { value: string };', 'export interface Gamma { value: string; }'].join('\n'),
    );
    sources.set(
      '/virtual/types-b.ts',
      ['export type Alpha = { value: string };', 'export interface Gamma { value: string; }'].join('\n'),
    );

    let program = createProgram(sources);
    // Act
    let groups = detectExactDuplicates(program, 5);
    let typeGroup = findGroupByKind(groups, 'type');
    let interfaceGroup = findGroupByKind(groups, 'interface');

    // Assert
    expect(typeGroup).not.toBeNull();
    expect(interfaceGroup).not.toBeNull();
  });

  it('should not report duplicates when literal values differ even if structure matches', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set(
      '/virtual/literals.ts',
      [
        'export function one() {',
        '  const value = 1;',
        '  return value + 1;',
        '}',
        'export function two() {',
        '  const value = 2;',
        '  return value + 2;',
        '}',
      ].join('\n'),
    );

    let program = createProgram(sources);
    // Act
    let groups = detectExactDuplicates(program, 10);
    let functionGroup = findGroupByKind(groups, 'function');

    // Assert
    expect(functionGroup).toBeNull();
  });

  it('should not report duplicates when size is below the threshold', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/small.ts', ['export function a() { return 1; }', 'export function b() { return 1; }'].join('\n'));

    let program = createProgram(sources);
    // Act
    let groups = detectExactDuplicates(program, 200);

    // Assert
    expect(groups.length).toBe(0);
  });
});

const createProgram = (sources: Map<string, string>): ParsedFile[] => {
  const files: ParsedFile[] = [];

  for (const [filePath, sourceText] of sources.entries()) {
    files.push(parseSource(filePath, sourceText));
  }

  return files;
};

const findGroupByKind = (groups: ReadonlyArray<DuplicateGroup>, kind: string) => {
  return groups.find(group => group.items.some(item => item.kind === kind)) ?? null;
};

const getGroupItems = (group: DuplicateGroup | null): ReadonlyArray<DuplicateGroup['items'][number]> => {
  if (!group) {
    throw new Error('Expected duplicate group');
  }

  return group.items;
};

const getGroupFilePaths = (group: DuplicateGroup | null): string[] => {
  return getGroupItems(group).map(item => item.filePath);
};
