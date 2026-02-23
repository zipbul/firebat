import { describe, expect, it } from 'bun:test';

import type { ParsedFile } from '../../engine/types';
import type { WasteFinding } from '../../types';

import { parseSource } from '../../engine/ast/parse-source';
import { detectWaste } from './detector';

describe('detector', () => {
  it('should report a dead-store finding when a write is never read', () => {
    // Arrange
    let fileName = '/virtual/waste.ts';
    let source = ['function deadStore() {', '  let unused = 1;', '  return 0;', '}'].join('\n');
    let program = createProgram(fileName, source);
    // Act
    let findings = detectWaste(program);

    // Assert
    expect(hasFinding(findings, 'dead-store', 'unused')).toBe(true);
  });

  it('should not report a dead-store finding when a value is read before return', () => {
    // Arrange
    let fileName = '/virtual/read.ts';
    let source = ['function readValue() {', '  let value = 1;', '  return value;', '}'].join('\n');
    let program = createProgram(fileName, source);
    // Act
    let findings = detectWaste(program);

    // Assert
    expect(hasFinding(findings, 'dead-store', 'value')).toBe(false);
  });

  it('should not report a dead-store finding for a for-of loop variable when it is read in the loop body', () => {
    // Arrange
    let fileName = '/virtual/for-of.ts';
    let source = [
      'function loopReadsIteratorValue() {',
      '  let total = 0;',
      '  for (const value of [1, 2, 3]) {',
      '    total += value;',
      '  }',
      '  return total;',
      '}',
    ].join('\n');
    let program = createProgram(fileName, source);
    // Act
    let findings = detectWaste(program);

    // Assert
    expect(hasFinding(findings, 'dead-store', 'value')).toBe(false);
  });

  it('should report a dead-store-overwrite finding when a non-declaration write is overwritten', () => {
    // Arrange
    let fileName = '/virtual/overwrite.ts';
    let source = ['function overwrite() {', '  let value = 0;', '  value = 1;', '  value = 2;', '  return value;', '}'].join(
      '\n',
    );
    let program = createProgram(fileName, source);
    // Act
    let findings = detectWaste(program);

    // Assert
    expect(hasFinding(findings, 'dead-store-overwrite', 'value')).toBe(true);
  });

  it('should not report a dead-store-overwrite finding when an overwritten value is read between writes', () => {
    // Arrange
    let fileName = '/virtual/read-between.ts';
    let source = [
      'function readBetween() {',
      '  let value = 0;',
      '  value = 1;',
      '  let use = value;',
      '  value = 2;',
      '  return use + value;',
      '}',
    ].join('\n');
    let program = createProgram(fileName, source);
    // Act
    let findings = detectWaste(program);

    // Assert
    expect(hasFinding(findings, 'dead-store-overwrite', 'value')).toBe(false);
  });

  it('should report a dead-store finding when a value is read only inside a non-invoked closure', () => {
    // Arrange
    let fileName = '/virtual/closure-unused.ts';
    let source = [
      'function closureUnused() {',
      '  let value = 1;',
      '  function readLater() {',
      '    return value;',
      '  }',
      '  return 0;',
      '}',
    ].join('\n');
    let program = createProgram(fileName, source);
    // Act
    let findings = detectWaste(program);

    // Assert
    expect(hasFinding(findings, 'dead-store', 'value')).toBe(true);
  });

  it('should not report a dead-store finding when a value is read by an immediately-invoked function', () => {
    // Arrange
    let fileName = '/virtual/iife.ts';
    let source = ['function iifeRead() {', '  let value = 1;', '  (() => value)();', '  return 0;', '}'].join('\n');
    let program = createProgram(fileName, source);
    // Act
    let findings = detectWaste(program);

    // Assert
    expect(hasFinding(findings, 'dead-store', 'value')).toBe(false);
  });

  it('should report a dead-store finding when inside a class method', () => {
    // Arrange
    let fileName = '/virtual/class-method.ts';
    let source = ['class Foo {', '  method() {', '    let unused = 1;', '    return 0;', '  }', '}'].join('\n');
    let program = createProgram(fileName, source);
    // Act
    let findings = detectWaste(program);

    // Assert
    expect(hasFinding(findings, 'dead-store', 'unused')).toBe(true);
  });

  it('should not report dead-store or overwrite findings when a compound assignment is used', () => {
    // Arrange
    let fileName = '/virtual/compound.ts';
    let source = ['function compound() {', '  let value = 1;', '  value += 1;', '  return value;', '}'].join('\n');
    let program = createProgram(fileName, source);
    // Act
    let findings = detectWaste(program);

    // Assert
    expect(hasFinding(findings, 'dead-store', 'value')).toBe(false);
    expect(hasFinding(findings, 'dead-store-overwrite', 'value')).toBe(false);
  });

  it('should not report a dead-store-overwrite finding when a ||= operator does not write due to a definitely-truthy initializer', () => {
    // Arrange
    let fileName = '/virtual/logical-or-assign-skip.ts';
    let source = ['function logicalOrAssignSkip() {', '  let value = 1;', '  value ||= 2;', '  return value;', '}'].join('\n');
    let program = createProgram(fileName, source);
    // Act
    let findings = detectWaste(program);

    // Assert
    expect(hasFinding(findings, 'dead-store-overwrite', 'value')).toBe(false);
  });

  it('should report a dead-store-overwrite finding when a ||= write is overwritten before being read', () => {
    // Arrange
    let fileName = '/virtual/logical-or-assign-overwrite.ts';
    let source = [
      'function logicalOrAssignOverwrite() {',
      '  let value = 0;',
      '  value ||= 2;',
      '  value = 3;',
      '  return value;',
      '}',
    ].join('\n');
    let program = createProgram(fileName, source);
    // Act
    let findings = detectWaste(program);

    // Assert
    expect(hasFinding(findings, 'dead-store-overwrite', 'value')).toBe(true);
  });

  it('should report a dead-store-overwrite finding when a ??= write is overwritten before being read', () => {
    // Arrange
    let fileName = '/virtual/nullish-assign-overwrite.ts';
    let source = [
      'function nullishAssignOverwrite() {',
      '  let value = null;',
      '  value ??= 2;',
      '  value = 3;',
      '  return value;',
      '}',
    ].join('\n');
    let program = createProgram(fileName, source);
    // Act
    let findings = detectWaste(program);

    // Assert
    expect(hasFinding(findings, 'dead-store-overwrite', 'value')).toBe(true);
  });

  it('should not report dead-store findings for the key when an assignment target reads identifiers', () => {
    // Arrange
    let fileName = '/virtual/assignment-target.ts';
    let source = [
      'function assignmentTarget() {',
      '  let key = "a";',
      '  let obj = {} as Record<string, number>;',
      '  obj[key] = 1;',
      '  return key;',
      '}',
    ].join('\n');
    let program = createProgram(fileName, source);
    // Act
    let findings = detectWaste(program);

    // Assert
    expect(hasFinding(findings, 'dead-store', 'key')).toBe(false);
  });

  it('should not report a dead-store finding when destructuring reads a bound value', () => {
    // Arrange
    let fileName = '/virtual/destructure.ts';
    let source = [
      'function destructureRead() {',
      '  let obj = { value: 1 };',
      '  let { value } = obj;',
      '  return value;',
      '}',
    ].join('\n');
    let program = createProgram(fileName, source);
    // Act
    let findings = detectWaste(program);

    // Assert
    expect(hasFinding(findings, 'dead-store', 'value')).toBe(false);
  });

  it('should report a dead-store-overwrite finding when a destructuring assignment write is overwritten before being read', () => {
    // Arrange
    let fileName = '/virtual/destructure-overwrite.ts';
    let source = [
      'function destructureOverwrite() {',
      '  let value = 0;',
      '  ({ value } = { value: 1 });',
      '  value = 2;',
      '  return value;',
      '}',
    ].join('\n');
    let program = createProgram(fileName, source);
    // Act
    let findings = detectWaste(program);

    // Assert
    expect(hasFinding(findings, 'dead-store-overwrite', 'value')).toBe(true);
  });

  it('should report a dead-store finding when a value is only referenced in a destructuring default that is statically not evaluated', () => {
    // Arrange
    let fileName = '/virtual/destructure-default-not-evaluated.ts';
    let source = [
      'function destructureDefaultNotEvaluated() {',
      '  let value = 1;',
      '  let { a = value } = { a: 2 };',
      '  return 0;',
      '}',
    ].join('\n');
    let program = createProgram(fileName, source);
    // Act
    let findings = detectWaste(program);

    // Assert
    expect(hasFinding(findings, 'dead-store', 'value')).toBe(true);
  });

  it('should not report a dead-store finding when a value is referenced in a destructuring default that is statically evaluated', () => {
    // Arrange
    let fileName = '/virtual/destructure-default-evaluated.ts';
    let source = [
      'function destructureDefaultEvaluated() {',
      '  let value = 1;',
      '  let { a = value } = {};',
      '  return 0;',
      '}',
    ].join('\n');
    let program = createProgram(fileName, source);
    // Act
    let findings = detectWaste(program);

    // Assert
    expect(hasFinding(findings, 'dead-store', 'value')).toBe(false);
  });

  it('should not report a dead-store finding when a loop exits via break and the value is read after the loop', () => {
    // Arrange
    let fileName = '/virtual/break.ts';
    let source = [
      'function breakLoop() {',
      '  let value = 0;',
      '  while (true) {',
      '    value = 1;',
      '    break;',
      '  }',
      '  return value;',
      '}',
    ].join('\n');
    let program = createProgram(fileName, source);
    // Act
    let findings = detectWaste(program);

    // Assert
    expect(hasFinding(findings, 'dead-store', 'value')).toBe(false);
  });

  it('should report a dead-store finding when a value is read only inside a statically-unreachable loop body', () => {
    // Arrange
    let fileName = '/virtual/unreachable-loop.ts';
    let source = [
      'function unreachableLoop() {',
      '  let value = 0;',
      '  while (false) {',
      '    value;',
      '  }',
      '  return 0;',
      '}',
    ].join('\n');
    let program = createProgram(fileName, source);
    // Act
    let findings = detectWaste(program);

    // Assert
    expect(hasFinding(findings, 'dead-store', 'value')).toBe(true);
  });

  it('should not report a dead-store finding when a loop continues early and the value is read after the loop', () => {
    // Arrange
    let fileName = '/virtual/continue.ts';
    let source = [
      'function continueLoop() {',
      '  let value = 0;',
      '  for (let index = 0; index < 1; index += 1) {',
      '    value = 1;',
      '    continue;',
      '  }',
      '  return value;',
      '}',
    ].join('\n');
    let program = createProgram(fileName, source);
    // Act
    let findings = detectWaste(program);

    // Assert
    expect(hasFinding(findings, 'dead-store', 'value')).toBe(false);
  });

  it('should not report a dead-store finding when a switch case exits via break and the value is read after the switch', () => {
    // Arrange
    let fileName = '/virtual/switch.ts';
    let source = [
      'function switchBreak() {',
      '  let value = 0;',
      '  switch (value) {',
      '    case 0:',
      '      value = 2;',
      '      break;',
      '    default:',
      '      value = 3;',
      '  }',
      '  return value;',
      '}',
    ].join('\n');
    let program = createProgram(fileName, source);
    // Act
    let findings = detectWaste(program);

    // Assert
    expect(hasFinding(findings, 'dead-store', 'value')).toBe(false);
  });

  it('should report a dead-store-overwrite finding when a switch default falls through into a later case and overwrites the write', () => {
    // Arrange
    let fileName = '/virtual/switch-default-middle-fallthrough.ts';
    let source = [
      'function switchDefaultMiddleFallthrough(input: number) {',
      '  let result = 0;',
      '  switch (input) {',
      '    default:',
      '      result = 1;',
      '    case 2:',
      '      result = 2;',
      '      break;',
      '  }',
      '  return result;',
      '}',
    ].join('\n');
    let program = createProgram(fileName, source);
    // Act
    let findings = detectWaste(program);

    // Assert
    expect(hasFinding(findings, 'dead-store-overwrite', 'result')).toBe(true);
  });

  it('should not report a dead-store-overwrite finding when a switch default exits via break before later cases', () => {
    // Arrange
    let fileName = '/virtual/switch-default-middle-break.ts';
    let source = [
      'function switchDefaultMiddleBreak(input: number) {',
      '  let result = 0;',
      '  switch (input) {',
      '    default:',
      '      result = 1;',
      '      break;',
      '    case 2:',
      '      result = 2;',
      '      break;',
      '  }',
      '  return result;',
      '}',
    ].join('\n');
    let program = createProgram(fileName, source);
    // Act
    let findings = detectWaste(program);

    // Assert
    expect(hasFinding(findings, 'dead-store-overwrite', 'result')).toBe(false);
  });

  it('should report a dead-store finding when a value is only referenced in a switch case expression that is unreachable due to an earlier static match', () => {
    // Arrange
    let fileName = '/virtual/unreachable-switch-case-expression.ts';
    let source = [
      'function unreachableSwitchCaseExpression() {',
      '  let value = 1;',
      '  switch (0) {',
      '    case 0:',
      '      break;',
      '    case (value):',
      '      break;',
      '  }',
      '  return 0;',
      '}',
    ].join('\n');
    let program = createProgram(fileName, source);
    // Act
    let findings = detectWaste(program);

    // Assert
    expect(hasFinding(findings, 'dead-store', 'value')).toBe(true);
  });

  it('should not report a dead-store finding when a value is read in a finally block after a return', () => {
    // Arrange
    let fileName = '/virtual/finally-read.ts';
    let source = [
      'function finallyRead() {',
      '  let value = 1;',
      '  try {',
      '    return 0;',
      '  } finally {',
      '    value;',
      '  }',
      '}',
    ].join('\n');
    let program = createProgram(fileName, source);
    // Act
    let findings = detectWaste(program);

    // Assert
    expect(hasFinding(findings, 'dead-store', 'value')).toBe(false);
  });

  it('should not report a dead-store finding when a labeled break exits an outer loop and the value is read after the loop', () => {
    // Arrange
    let fileName = '/virtual/labeled-break.ts';
    let source = [
      'function labeledBreak() {',
      '  let value = 0;',
      '  outer: for (let index = 0; index < 1; index += 1) {',
      '    while (true) {',
      '      value = 1;',
      '      break outer;',
      '    }',
      '  }',
      '  return value;',
      '}',
    ].join('\n');
    let program = createProgram(fileName, source);
    // Act
    let findings = detectWaste(program);

    // Assert
    expect(hasFinding(findings, 'dead-store', 'value')).toBe(false);
  });

  it('should not report a dead-store finding when a value is read only on a short-circuit branch', () => {
    // Arrange
    let fileName = '/virtual/short-circuit-read.ts';
    let source = ['function shortCircuitRead(cond: boolean) {', '  let value = 1;', '  cond && value;', '  return 0;', '}'].join(
      '\n',
    );
    let program = createProgram(fileName, source);
    // Act
    let findings = detectWaste(program);

    // Assert
    expect(hasFinding(findings, 'dead-store', 'value')).toBe(false);
  });

  it('should not report a dead-store finding when a value is read only on a conditional expression branch', () => {
    // Arrange
    let fileName = '/virtual/conditional-expression-read.ts';
    let source = [
      'function conditionalExpressionRead(cond: boolean) {',
      '  let value = 1;',
      '  cond ? value : 0;',
      '  return 0;',
      '}',
    ].join('\n');
    let program = createProgram(fileName, source);
    // Act
    let findings = detectWaste(program);

    // Assert
    expect(hasFinding(findings, 'dead-store', 'value')).toBe(false);
  });

  it('should report a dead-store finding when a value is only referenced in a never-executed short-circuit branch', () => {
    // Arrange
    let fileName = '/virtual/short-circuit-never.ts';
    let source = ['function shortCircuitNever() {', '  let value = 1;', '  false && value;', '  return 0;', '}'].join('\n');
    let program = createProgram(fileName, source);
    // Act
    let findings = detectWaste(program);

    // Assert
    expect(hasFinding(findings, 'dead-store', 'value')).toBe(true);
  });

  it('should report a dead-store finding when a value is only referenced in an unreachable if branch', () => {
    // Arrange
    let fileName = '/virtual/if-unreachable.ts';
    let source = [
      'function ifUnreachable() {',
      '  let value = 1;',
      '  if (false) {',
      '    value;',
      '  }',
      '  return 0;',
      '}',
    ].join('\n');
    let program = createProgram(fileName, source);
    // Act
    let findings = detectWaste(program);

    // Assert
    expect(hasFinding(findings, 'dead-store', 'value')).toBe(true);
  });

  it('should report a dead-store finding when a value is only referenced in an unreachable conditional expression branch', () => {
    // Arrange
    let fileName = '/virtual/conditional-unreachable.ts';
    let source = ['function conditionalUnreachable() {', '  let value = 1;', '  true ? 0 : value;', '  return 0;', '}'].join(
      '\n',
    );
    let program = createProgram(fileName, source);
    // Act
    let findings = detectWaste(program);

    // Assert
    expect(hasFinding(findings, 'dead-store', 'value')).toBe(true);
  });

  it('should report a dead-store finding when a value is only referenced in an unreachable branch guarded by 0', () => {
    // Arrange
    let fileName = '/virtual/if-zero-unreachable.ts';
    let source = [
      'function ifZeroUnreachable() {',
      '  let value = 1;',
      '  if (0) {',
      '    value;',
      '  }',
      '  return 0;',
      '}',
    ].join('\n');
    let program = createProgram(fileName, source);
    // Act
    let findings = detectWaste(program);

    // Assert
    expect(hasFinding(findings, 'dead-store', 'value')).toBe(true);
  });

  it('should report a dead-store finding when a value is only referenced in an unreachable branch guarded by an empty string', () => {
    // Arrange
    let fileName = '/virtual/if-empty-string-unreachable.ts';
    let source = [
      'function ifEmptyStringUnreachable() {',
      '  let value = 1;',
      "  if ('') {",
      '    value;',
      '  }',
      '  return 0;',
      '}',
    ].join('\n');
    let program = createProgram(fileName, source);
    // Act
    let findings = detectWaste(program);

    // Assert
    expect(hasFinding(findings, 'dead-store', 'value')).toBe(true);
  });

  it('should not report a dead-store finding when a value is referenced in a reachable branch guarded by 1', () => {
    // Arrange
    let fileName = '/virtual/if-one-reachable.ts';
    let source = ['function ifOneReachable() {', '  let value = 1;', '  if (1) {', '    value;', '  }', '  return 0;', '}'].join(
      '\n',
    );
    let program = createProgram(fileName, source);
    // Act
    let findings = detectWaste(program);

    // Assert
    expect(hasFinding(findings, 'dead-store', 'value')).toBe(false);
  });

  it('should report a dead-store finding when a value is only referenced in an unreachable branch guarded by 0n', () => {
    // Arrange
    let fileName = '/virtual/if-bigint-zero-unreachable.ts';
    let source = [
      'function ifBigintZeroUnreachable() {',
      '  let value = 1;',
      '  if (0n) {',
      '    value;',
      '  }',
      '  return 0;',
      '}',
    ].join('\n');
    let program = createProgram(fileName, source);
    // Act
    let findings = detectWaste(program);

    // Assert
    expect(hasFinding(findings, 'dead-store', 'value')).toBe(true);
  });

  it('should report a dead-store finding when a value is only referenced in an unreachable branch guarded by void 0', () => {
    // Arrange
    let fileName = '/virtual/if-void-zero-unreachable.ts';
    let source = [
      'function ifVoidZeroUnreachable() {',
      '  let value = 1;',
      '  if (void 0) {',
      '    value;',
      '  }',
      '  return 0;',
      '}',
    ].join('\n');
    let program = createProgram(fileName, source);
    // Act
    let findings = detectWaste(program);

    // Assert
    expect(hasFinding(findings, 'dead-store', 'value')).toBe(true);
  });
});

const createProgram = (fileName: string, sourceText: string): ParsedFile[] => {
  return [parseSource(fileName, sourceText)];
};

const hasFinding = (findings: ReadonlyArray<WasteFinding>, kind: string, snippet: string) => {
  return findings.some(finding => finding.kind === kind && finding.label.includes(snippet));
};
