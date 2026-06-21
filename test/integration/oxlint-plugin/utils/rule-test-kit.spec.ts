/**
 * Unit tests for applyFixes() in rule-test-kit.ts
 * (Part3 #12: overlapping fix throw path coverage)
 */
import { describe, expect, it } from 'bun:test';

import type { ReportDescriptor } from '../../../../src/test-api';

import { applyFixes } from './rule-test-kit';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeReport = (start: number, end: number, text: string): ReportDescriptor => ({
  node: { type: 'Identifier', range: [start, end] } as unknown as ReportDescriptor['node'],
  messageId: 'test',
  fix: fixer => fixer.replaceTextRange([start, end], text),
});

const makeNoFixReport = (): ReportDescriptor => ({
  node: { type: 'Identifier', range: [0, 0] } as unknown as ReportDescriptor['node'],
  messageId: 'test',
});

const makeNotFnReport = (): ReportDescriptor => ({
  node: { type: 'Identifier', range: [0, 0] } as unknown as ReportDescriptor['node'],
  messageId: 'test',
  fix: 'notafunction' as unknown as NonNullable<ReportDescriptor['fix']>,
});

const makeUndefinedTextReport = (start: number, end: number): ReportDescriptor => ({
  node: { type: 'Identifier', range: [start, end] } as unknown as ReportDescriptor['node'],
  messageId: 'test',
  fix: fixer => ({ ...fixer.removeRange([start, end]), text: undefined as unknown as string }),
});

const makeBadRangeReport = (): ReportDescriptor => ({
  node: { type: 'Identifier', range: [0, 0] } as unknown as ReportDescriptor['node'],
  messageId: 'test',
  fix: () => ({ range: [1] as unknown as [number, number], text: 'X' }),
});

interface SingleFixCase {
  readonly title: string;
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
  readonly expected: string;
}

// One makeReport fix applied to one input → one expected output. Each row is a
// distinct behaviour (replace / delete / replace-all / zero-length insert).
const singleFixCases: SingleFixCase[] = [
  {
    title: 'should apply a single replacement fix correctly',
    text: 'const foo = 1;',
    start: 6,
    end: 9,
    replacement: 'bar',
    expected: 'const bar = 1;',
  },
  {
    title: 'should apply a single deletion fix (empty text) over a range',
    text: 'abcde',
    start: 1,
    end: 3,
    replacement: '',
    expected: 'ade',
  },
  {
    title: 'should replace entire text when fix range spans [0, text.length]',
    text: 'oldvalue',
    start: 0,
    end: 8,
    replacement: 'newvalue',
    expected: 'newvalue',
  },
  {
    title: 'should insert text at position when fix range is zero-length [n, n]',
    text: 'ac',
    start: 1,
    end: 1,
    replacement: 'b',
    expected: 'abc',
  },
];

// ── applyFixes ────────────────────────────────────────────────────────────────

describe('applyFixes', () => {
  it('should return original text when reports is empty', () => {
    // Arrange
    const text = 'const x = 1;';
    const reports: ReportDescriptor[] = [];
    // Act
    const result = applyFixes(text, reports);

    // Assert
    expect(result).toBe(text);
  });

  it.each(singleFixCases)('$title', ({ text, start, end, replacement, expected }) => {
    // Arrange
    const reports = [makeReport(start, end, replacement)];
    // Act
    const result = applyFixes(text, reports);

    // Assert
    expect(result).toBe(expected);
  });

  it('should apply two non-overlapping fixes from right to left', () => {
    // Arrange
    const text = 'hello world';
    // fix1: [0,5] → 'HELLO', fix2: [6,11] → 'WORLD'
    const reports = [makeReport(0, 5, 'HELLO'), makeReport(6, 11, 'WORLD')];
    // Act
    const result = applyFixes(text, reports);

    // Assert
    expect(result).toBe('HELLO WORLD');
  });

  it('should skip reports where fix property is not a function', () => {
    // Arrange
    const text = 'abc';
    const reports: ReportDescriptor[] = [makeNotFnReport()];
    // Act
    const result = applyFixes(text, reports);

    // Assert
    expect(result).toBe(text);
  });

  it('should return original text when all reports have no fix', () => {
    // Arrange
    const text = 'def';
    const reports: ReportDescriptor[] = [makeNoFixReport(), makeNoFixReport()];
    // Act
    const result = applyFixes(text, reports);

    // Assert
    expect(result).toBe(text);
  });

  it('should skip a fix whose range array length is not 2', () => {
    // Arrange
    const text = 'xyz';
    const reports: ReportDescriptor[] = [makeBadRangeReport()];
    // Act
    const result = applyFixes(text, reports);

    // Assert
    expect(result).toBe(text);
  });

  it('should not throw when two fixes are adjacent (range1[1] === range2[0])', () => {
    // Arrange
    const text = 'abcd';
    // [0,2] and [2,4] — adjacent, not overlapping (next.range[1]=2 not > current.range[0]=2)
    const reports = [makeReport(0, 2, 'XX'), makeReport(2, 4, 'YY')];

    // Act & Assert
    expect(() => applyFixes(text, reports)).not.toThrow();
    expect(applyFixes(text, reports)).toBe('XXYY');
  });

  it('should use empty string as replacement when fix.text is undefined', () => {
    // Arrange
    const text = 'hello';
    const reports: ReportDescriptor[] = [makeUndefinedTextReport(1, 3)];
    // Act
    const result = applyFixes(text, reports);

    // Assert
    expect(result).toBe('hlo');
  });

  it('should apply three non-overlapping fixes given in reverse range order', () => {
    // Arrange
    const text = 'aabbcc';
    // reports in leftmost-first order → sort should handle right-to-left application
    const reports = [makeReport(0, 2, 'XX'), makeReport(2, 4, 'YY'), makeReport(4, 6, 'ZZ')];
    // Act
    const result = applyFixes(text, reports);

    // Assert
    expect(result).toBe('XXYYZZ');
  });

  it('should throw when two fixes overlap', () => {
    // Arrange
    const text = '12345678';
    // [0,5] and [3,8] overlap (3 < 5)
    const reports = [makeReport(0, 5, 'A'), makeReport(3, 8, 'B')];

    // Act & Assert
    expect(() => applyFixes(text, reports)).toThrow('Overlapping fixes are not supported');
  });

  it('should throw when last two of three fixes overlap', () => {
    // Arrange
    const text = '123456789';
    // non-overlap [0,2], then overlap [4,8] + [6,9]
    const reports = [makeReport(0, 2, 'A'), makeReport(4, 8, 'B'), makeReport(6, 9, 'C')];

    // Act & Assert
    expect(() => applyFixes(text, reports)).toThrow('Overlapping fixes are not supported');
  });

  it('should return empty string when text is empty and reports is empty', () => {
    // Arrange
    const text = '';
    const reports: ReportDescriptor[] = [];
    // Act
    const result = applyFixes(text, reports);

    // Assert
    expect(result).toBe('');
  });

  it('should produce identical output on two successive calls with same arguments', () => {
    // Arrange
    const text = 'foo bar';
    const reports = [makeReport(0, 3, 'baz')];
    // Act
    const first = applyFixes(text, reports);
    const second = applyFixes(text, reports);

    // Assert
    expect(first).toBe(second);
  });

  it('should produce the same result regardless of report input order', () => {
    // Arrange
    const text = 'hello world';
    const r1 = makeReport(0, 5, 'HELLO');
    const r2 = makeReport(6, 11, 'WORLD');
    // Act
    const forwardResult = applyFixes(text, [r1, r2]);
    const reverseResult = applyFixes(text, [r2, r1]);

    // Assert
    expect(forwardResult).toBe(reverseResult);
  });
});
