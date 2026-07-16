import { describe, expect, it } from 'bun:test';

import {
  expectLength,
  parsePFile as file,
  parsePFileWithErrors as fileWithErrors,
} from '../../../test/integration/shared/test-kit';
import { analyzeGiantFile, createEmptyGiantFile } from './analyzer';

/** Analyze `files` under maxLines:3 and assert exactly one giant-file finding. */
const analyzeOverLimit = (files: Parameters<typeof analyzeGiantFile>[0]): ReturnType<typeof analyzeGiantFile> =>
  expectLength(analyzeGiantFile(files, { maxLines: 3 }), 1) as unknown as ReturnType<typeof analyzeGiantFile>;

describe('giant-file/analyzer', () => {
  it('should return empty result when files are empty', () => {
    // Arrange
    const files: any[] = [];
    // Act
    const result = analyzeGiantFile(files as any, { maxLines: 10 });

    // Assert
    expect(result).toEqual(createEmptyGiantFile());
  });

  // INVERTED (giant-file surgery D4, was: 'should ignore files with parse errors'):
  // the measurement is raw source text, no AST is needed — parse-errored files
  // are counted like any other file, not skipped. RED today: current code still
  // has `if (file.errors.length > 0) continue`.
  it('RED: should count files with parse errors instead of skipping them', () => {
    // Arrange
    const files = [fileWithErrors('src/a.ts', 'export const x =')];
    // Act
    const result = analyzeGiantFile(files as any, { maxLines: 0 });

    // Assert
    expect(result.length).toBe(1);
    expect(result[0]?.kind).toBe('giant-file');
  });

  it('should report when lineCount exceeds maxLines', () => {
    // Arrange
    const sourceText = ['export const a = 1;', 'export const b = 2;', 'export const c = 3;', 'export const d = 4;'].join('\n');
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeOverLimit(files as any);

    expect(result[0]?.kind).toBe('giant-file');
    expect(result[0]?.metrics.lineCount).toBeGreaterThan(3);
  });

  it('should not report when lineCount is within maxLines', () => {
    // Arrange
    const sourceText = ['export const a = 1;', 'export const b = 2;'].join('\n');
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeGiantFile(files as any, { maxLines: 3 });

    // Assert
    expect(result.length).toBe(0);
  });

  interface TrailingNewlineCase {
    name: string;
    sourceText: string;
  }

  const trailingNewlineCases: TrailingNewlineCase[] = [
    { name: 'should not count trailing LF as an extra line (LF)', sourceText: 'a\nb\nc\n' },
    { name: 'should not count trailing CRLF as an extra line', sourceText: 'a\r\nb\r\nc\r\n' },
  ];

  it.each(trailingNewlineCases)('$name', ({ sourceText }) => {
    // Arrange — 3 lines of content + a trailing newline (commonly produced by editors)
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeGiantFile(files as any, { maxLines: 0 });

    // Assert
    expect(result.length).toBe(1);
    expect(result[0]?.metrics.lineCount).toBe(3);
  });

  it('should produce identical lineCount whether or not file ends with trailing newline', () => {
    // Arrange
    const withTrailing = 'a\nb\nc\n';
    const withoutTrailing = 'a\nb\nc';
    // Act
    const r1 = analyzeGiantFile([file('src/a.ts', withTrailing)] as any, { maxLines: 0 });
    const r2 = analyzeGiantFile([file('src/b.ts', withoutTrailing)] as any, { maxLines: 0 });

    // Assert
    expect(r1[0]?.metrics.lineCount).toBe(3);
    expect(r2[0]?.metrics.lineCount).toBe(3);
    expect(r1[0]?.metrics.lineCount).toBe(r2[0]?.metrics.lineCount);
  });

  // ── D3: closed counting rule — ECMAScript line-terminator sequences ─────────
  // (CRLF as one; LF; CR; U+2028; U+2029) + 1 iff text does not end in a
  // terminator; empty = 0. Current code (`split(/\r?\n/)`) only recognizes LF
  // and CRLF, so a lone CR / U+2028 / U+2029 is invisible to it (undercounts).
  // `maxLines: 0` guarantees a finding fires for any non-empty content, so the
  // finding's `metrics.lineCount` is the exact counting-rule signal under test.

  it('RED: lone CR ("a\\rb") counts as one terminator — lineCount 2', () => {
    // Arrange
    const files = [file('src/a.ts', 'a\rb')];
    // Act
    const result = analyzeGiantFile(files as any, { maxLines: 0 });

    // Assert
    expect(result[0]?.metrics.lineCount).toBe(2);
  });

  it('RED: U+2028 line separator ("a\\u2028b") counts as one terminator — lineCount 2', () => {
    // Arrange
    const files = [file('src/a.ts', 'a' + String.fromCharCode(0x2028) + 'b')];
    // Act
    const result = analyzeGiantFile(files as any, { maxLines: 0 });

    // Assert
    expect(result[0]?.metrics.lineCount).toBe(2);
  });

  it('RED: U+2029 paragraph separator ("a\\u2029b") counts as one terminator — lineCount 2', () => {
    // Arrange
    const files = [file('src/a.ts', 'a' + String.fromCharCode(0x2029) + 'b')];
    // Act
    const result = analyzeGiantFile(files as any, { maxLines: 0 });

    // Assert
    expect(result[0]?.metrics.lineCount).toBe(2);
  });

  it('RED: mixed lone-CR then CRLF ("a\\r\\r\\nb") counts 2 distinct terminators — lineCount 3', () => {
    // Arrange — char1 is a lone CR (not followed by \n), chars 2-3 are a CRLF pair.
    const files = [file('src/a.ts', 'a\r\r\nb')];
    // Act
    const result = analyzeGiantFile(files as any, { maxLines: 0 });

    // Assert
    expect(result[0]?.metrics.lineCount).toBe(3);
  });

  it('RED: trailing lone CR ("a\\rb\\r") is a terminator, not an extra line — lineCount 2', () => {
    // Arrange
    const files = [file('src/a.ts', 'a\rb\r')];
    // Act
    const result = analyzeGiantFile(files as any, { maxLines: 0 });

    // Assert
    expect(result[0]?.metrics.lineCount).toBe(2);
  });

  // PIN (verified green today): a lone CR is the whole file's content — current
  // code's `split(/\r?\n/)` finds no `\n` at all and returns the untouched string
  // as a single one-element array (lineCount 1), which happens to already match
  // the closed rule's answer (1 terminator, text ends in it, no +1) — same
  // number, different (currently accidental) reasoning.
  it('PIN: CR-only file ("\\r") — lineCount 1', () => {
    // Arrange
    const files = [file('src/a.ts', '\r')];
    // Act
    const result = analyzeGiantFile(files as any, { maxLines: 0 });

    // Assert
    expect(result[0]?.metrics.lineCount).toBe(1);
  });

  // ── PINs: already-correct boundary / shape behaviors (regression pins) ──────

  it('PIN: maxLines=0 flags every non-empty file', () => {
    // Arrange
    const files = [file('src/a.ts', 'x')];
    // Act
    const result = analyzeGiantFile(files as any, { maxLines: 0 });

    // Assert
    expect(result.length).toBe(1);
    expect(result[0]?.metrics.lineCount).toBe(1);
  });

  it('PIN: a one-liner of any width has lineCount 1', () => {
    // Arrange
    const files = [file('src/a.ts', 'x'.repeat(500))];
    // Act
    const result = analyzeGiantFile(files as any, { maxLines: 0 });

    // Assert
    expect(result[0]?.metrics.lineCount).toBe(1);
  });

  it('PIN: boundary — lineCount === maxLines does not report (K)', () => {
    // Arrange — exactly 5 lines, maxLines: 5
    const sourceText = ['a', 'b', 'c', 'd', 'e'].join('\n');
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeGiantFile(files as any, { maxLines: 5 });

    // Assert
    expect(result.length).toBe(0);
  });

  it('PIN: boundary — lineCount === maxLines + 1 reports (W)', () => {
    // Arrange — exactly 6 lines, maxLines: 5
    const sourceText = ['a', 'b', 'c', 'd', 'e', 'f'].join('\n');
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeGiantFile(files as any, { maxLines: 5 });

    // Assert
    expect(result.length).toBe(1);
    expect(result[0]?.metrics.lineCount).toBe(6);
  });

  // ── D2: `defaulted` provenance carried from options into the finding ────────
  // Post-surgery design: analyzeGiantFile receives `{ maxLines, defaulted }`;
  // direct callers pass `defaulted: false` explicitly. RED today: the analyzer's
  // options type has no `defaulted` field and never sets `metrics.defaulted`, so
  // both assertions below read `undefined` off the produced finding.

  it('RED: metrics.defaulted is true verbatim when options.defaulted is true', () => {
    // Arrange
    const sourceText = ['a', 'b', 'c', 'd'].join('\n');
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeGiantFile(files as any, { maxLines: 3, defaulted: true });

    // Assert
    expect(result[0]?.metrics.defaulted).toBe(true);
  });

  it('RED: metrics.defaulted is false verbatim when options.defaulted is false', () => {
    // Arrange
    const sourceText = ['a', 'b', 'c', 'd'].join('\n');
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeGiantFile(files as any, { maxLines: 3, defaulted: false });

    // Assert
    expect(result[0]?.metrics.defaulted).toBe(false);
  });
});
