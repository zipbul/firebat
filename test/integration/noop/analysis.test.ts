import { describe, expect, it } from 'bun:test';

import { analyzeNoop } from '../../../src/features/noop';
import { createProgramFromMap } from '../shared/test-kit';

function createNoopSource(): string {
  return ['export function noopCase() {', '  1;', '  if (true) {', '    return 0;', '  }', '  return 1;', '}'].join('\n');
}

function createSafeSource(): string {
  return [
    'export function safeCase(value) {',
    '  console.log(1);',
    '  if (value) {',
    '    return value;',
    '  }',
    '  return 0;',
    '}',
  ].join('\n');
}

function createObjectNoopSource(): string {
  return ['export function objectNoop() {', '  ({ value: 1 });', '  [1, 2, 3];', '  (() => 1);', '  return 0;', '}'].join('\n');
}

describe('integration/noop', () => {
  it('should report expression noops when statements have no effects', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/noop/noop.ts', createNoopSource());

    // Act
    let program = createProgramFromMap(sources);
    let analysis = analyzeNoop(program);
    let hasExpressionNoop = analysis.findings.some(finding => finding.kind === 'expression-noop');
    let hasConstantCondition = analysis.findings.some(finding => finding.kind === 'constant-condition');

    // Assert
    expect(hasExpressionNoop).toBe(true);
    expect(hasConstantCondition).toBe(true);
  });

  it('should not report findings when expressions have side effects', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/noop/safe.ts', createSafeSource());

    // Act
    let program = createProgramFromMap(sources);
    let analysis = analyzeNoop(program);

    // Assert
    expect(analysis.findings.length).toBe(0);
  });

  it('should return no findings when input is empty', () => {
    // Arrange
    let sources = new Map<string, string>();
    // Act
    let program = createProgramFromMap(sources);
    let analysis = analyzeNoop(program);

    // Assert
    expect(analysis.findings.length).toBe(0);
  });

  it('should report expression noops when objects and arrays are unused', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/noop/object.ts', createObjectNoopSource());

    // Act
    let program = createProgramFromMap(sources);
    let analysis = analyzeNoop(program);
    let expressionNoops = analysis.findings.filter(finding => finding.kind === 'expression-noop');

    // Assert
    expect(expressionNoops.length).toBeGreaterThanOrEqual(1);
  });

  it('should report empty-catch when catch block has no body', () => {
    // Arrange
    let sources = new Map<string, string>();
    let source = [
      'export function emptyCatch() {',
      '  try {',
      '    throw new Error("test");',
      '  } catch (e) {',
      '  }',
      '}',
    ].join('\n');

    sources.set('/virtual/noop/empty-catch.ts', source);

    // Act
    let program = createProgramFromMap(sources);
    let analysis = analyzeNoop(program);
    let emptyCatches = analysis.findings.filter(finding => finding.kind === 'empty-catch');

    // Assert
    expect(emptyCatches.length).toBe(1);
    expect(emptyCatches[0]?.confidence).toBe(0.8);
  });

  it('should report self-assignment when variable is assigned to itself', () => {
    // Arrange
    let sources = new Map<string, string>();
    let source = ['export function selfAssign() {', '  let x = 1;', '  x = x;', '  return x;', '}'].join('\n');

    sources.set('/virtual/noop/self-assign.ts', source);

    // Act
    let program = createProgramFromMap(sources);
    let analysis = analyzeNoop(program);
    let selfAssigns = analysis.findings.filter(finding => finding.kind === 'self-assignment');

    // Assert
    expect(selfAssigns.length).toBe(1);
    expect(selfAssigns[0]?.confidence).toBe(0.9);
  });

  it('should report self-assignment when member expression is assigned to itself', () => {
    // Arrange
    let sources = new Map<string, string>();
    let source = [
      'export function selfAssignMember() {',
      '  const obj = { a: 1 };',
      '  obj.a = obj.a;',
      '  this.x = this.x;',
      '  return obj.a;',
      '}',
    ].join('\n');

    sources.set('/virtual/noop/self-assign-member.ts', source);

    // Act
    let program = createProgramFromMap(sources);
    let analysis = analyzeNoop(program);
    let selfAssigns = analysis.findings.filter(finding => finding.kind === 'self-assignment');

    // Assert
    expect(selfAssigns.length).toBe(2);
  });

  it('should report constant-condition when if condition is statically truthy or falsy', () => {
    // Arrange
    let sources = new Map<string, string>();
    let source = [
      'export function constantConditionVariants() {',
      '  if (0) {',
      '    return 1;',
      '  }',
      '  if ("") {',
      '    return 2;',
      '  }',
      '  if (null) {',
      '    return 3;',
      '  }',
      '  if (void 0) {',
      '    return 4;',
      '  }',
      '  return 0;',
      '}',
    ].join('\n');

    sources.set('/virtual/noop/constant-condition-variants.ts', source);

    // Act
    let program = createProgramFromMap(sources);
    let analysis = analyzeNoop(program);
    let constantConditions = analysis.findings.filter(finding => finding.kind === 'constant-condition');

    // Assert
    expect(constantConditions.length).toBe(4);
  });

  it('should not report constant-condition when condition is while(true)', () => {
    // Arrange
    let sources = new Map<string, string>();
    let source = ['export function whileTrue() {', '  while (true) {', '    break;', '  }', '  return 0;', '}'].join('\n');

    sources.set('/virtual/noop/while-true.ts', source);

    // Act
    let program = createProgramFromMap(sources);
    let analysis = analyzeNoop(program);
    let constantConditions = analysis.findings.filter(finding => finding.kind === 'constant-condition');

    // Assert
    expect(constantConditions.length).toBe(0);
  });

  it('should report empty-function-body when function has no statements', () => {
    // Arrange
    let sources = new Map<string, string>();
    let source = ['export function emptyFunc() {', '}', 'export const emptyArrow = () => {', '};'].join('\n');

    sources.set('/virtual/noop/empty-func.ts', source);

    // Act
    let program = createProgramFromMap(sources);
    let analysis = analyzeNoop(program);
    let emptyBodies = analysis.findings.filter(finding => finding.kind === 'empty-function-body');

    // Assert
    expect(emptyBodies.length).toBeGreaterThanOrEqual(1);
    expect(emptyBodies[0]?.confidence).toBe(0.6);
  });

  it('should not report empty-catch when catch block has statements', () => {
    // Arrange
    let sources = new Map<string, string>();
    let source = [
      'export function handledCatch() {',
      '  try {',
      '    throw new Error("test");',
      '  } catch (e) {',
      '    console.log(e);',
      '  }',
      '}',
    ].join('\n');

    sources.set('/virtual/noop/handled-catch.ts', source);

    // Act
    let program = createProgramFromMap(sources);
    let analysis = analyzeNoop(program);
    let emptyCatches = analysis.findings.filter(finding => finding.kind === 'empty-catch');

    // Assert
    expect(emptyCatches.length).toBe(0);
  });
});
