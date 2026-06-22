import { describe, expect, it } from 'bun:test';
import { parseProgramAs as createProgram } from '../../../test/integration/shared/test-kit';

import type { ParsedFile } from '../../engine/types';
import type { WasteFinding } from '../../types';

import { parseSource } from '../../engine/ast/parse-source';
import { detectWaste } from './detector';

interface WasteExpectation {
  kind: string;
  snippet: string;
  present: boolean;
}

interface WasteCase {
  name: string;
  fileName: string;
  source: string[];
  expectations: WasteExpectation[];
}

const cases: WasteCase[] = [
  {
    name: 'should NOT report use=0 variable (CLAUDE.md: 사용처 0회 변수 no-unused-vars 영역)',
    fileName: '/virtual/waste.ts',
    source: ['function deadStore() {', '  let unused = 1;', '  return 0;', '}'],
    expectations: [{ kind: 'dead-store', snippet: 'unused', present: false }],
  },
  {
    name: 'should not report a dead-store finding when a value is read before return',
    fileName: '/virtual/read.ts',
    source: ['function readValue() {', '  let value = 1;', '  return value;', '}'],
    expectations: [{ kind: 'dead-store', snippet: 'value', present: false }],
  },
  {
    name: 'should not report a dead-store finding for a for-of loop variable when it is read in the loop body',
    fileName: '/virtual/for-of.ts',
    source: [
      'function loopReadsIteratorValue() {',
      '  let total = 0;',
      '  for (const value of [1, 2, 3]) {',
      '    total += value;',
      '  }',
      '  return total;',
      '}',
    ],
    expectations: [{ kind: 'dead-store', snippet: 'value', present: false }],
  },
  {
    name: 'should report a dead-store-overwrite finding when a non-declaration write is overwritten',
    fileName: '/virtual/overwrite.ts',
    source: ['function overwrite() {', '  let value = 0;', '  value = 1;', '  value = 2;', '  return value;', '}'],
    expectations: [{ kind: 'dead-store-overwrite', snippet: 'value', present: true }],
  },
  {
    name: 'should not report a dead-store-overwrite finding when an overwritten value is read between writes',
    fileName: '/virtual/read-between.ts',
    source: [
      'function readBetween() {',
      '  let value = 0;',
      '  value = 1;',
      '  let use = value;',
      '  value = 2;',
      '  return use + value;',
      '}',
    ],
    expectations: [{ kind: 'dead-store-overwrite', snippet: 'value', present: false }],
  },
  {
    name: 'should NOT report dead-store when value is captured by a closure (use is syntactic and dataflow respects closure capture)',
    fileName: '/virtual/closure-unused.ts',
    source: [
      'function closureUnused() {',
      '  let value = 1;',
      '  function readLater() {',
      '    return value;',
      '  }',
      '  return 0;',
      '}',
    ],
    expectations: [{ kind: 'dead-store', snippet: 'value', present: false }],
  },
  {
    name: 'should not report a dead-store finding when a value is read by an immediately-invoked function',
    fileName: '/virtual/iife.ts',
    source: ['function iifeRead() {', '  let value = 1;', '  (() => value)();', '  return 0;', '}'],
    expectations: [{ kind: 'dead-store', snippet: 'value', present: false }],
  },
  {
    name: 'should NOT report use=0 inside a class method (no-unused-vars 영역)',
    fileName: '/virtual/class-method.ts',
    source: ['class Foo {', '  method() {', '    let unused = 1;', '    return 0;', '  }', '}'],
    expectations: [{ kind: 'dead-store', snippet: 'unused', present: false }],
  },
  {
    name: 'should not report dead-store or overwrite findings when a compound assignment is used',
    fileName: '/virtual/compound.ts',
    source: ['function compound() {', '  let value = 1;', '  value += 1;', '  return value;', '}'],
    expectations: [
      { kind: 'dead-store', snippet: 'value', present: false },
      { kind: 'dead-store-overwrite', snippet: 'value', present: false },
    ],
  },
  {
    name: 'should not report a dead-store-overwrite finding when a ||= operator does not write due to a definitely-truthy initializer',
    fileName: '/virtual/logical-or-assign-skip.ts',
    source: ['function logicalOrAssignSkip() {', '  let value = 1;', '  value ||= 2;', '  return value;', '}'],
    expectations: [{ kind: 'dead-store-overwrite', snippet: 'value', present: false }],
  },
  {
    name: 'should report a dead-store-overwrite finding when a ||= write is overwritten before being read',
    fileName: '/virtual/logical-or-assign-overwrite.ts',
    source: [
      'function logicalOrAssignOverwrite() {',
      '  let value = 0;',
      '  value ||= 2;',
      '  value = 3;',
      '  return value;',
      '}',
    ],
    expectations: [{ kind: 'dead-store-overwrite', snippet: 'value', present: true }],
  },
  {
    name: 'should report a dead-store-overwrite finding when a ??= write is overwritten before being read',
    fileName: '/virtual/nullish-assign-overwrite.ts',
    source: [
      'function nullishAssignOverwrite() {',
      '  let value = null;',
      '  value ??= 2;',
      '  value = 3;',
      '  return value;',
      '}',
    ],
    expectations: [{ kind: 'dead-store-overwrite', snippet: 'value', present: true }],
  },
  {
    name: 'should not report dead-store findings for the key when an assignment target reads identifiers',
    fileName: '/virtual/assignment-target.ts',
    source: [
      'function assignmentTarget() {',
      '  let key = "a";',
      '  let obj = {} as Record<string, number>;',
      '  obj[key] = 1;',
      '  return key;',
      '}',
    ],
    expectations: [{ kind: 'dead-store', snippet: 'key', present: false }],
  },
  {
    name: 'should not report a dead-store finding when destructuring reads a bound value',
    fileName: '/virtual/destructure.ts',
    source: ['function destructureRead() {', '  let obj = { value: 1 };', '  let { value } = obj;', '  return value;', '}'],
    expectations: [{ kind: 'dead-store', snippet: 'value', present: false }],
  },
  {
    name: 'should report a dead-store-overwrite finding when a destructuring assignment write is overwritten before being read',
    fileName: '/virtual/destructure-overwrite.ts',
    source: [
      'function destructureOverwrite() {',
      '  let value = 0;',
      '  ({ value } = { value: 1 });',
      '  value = 2;',
      '  return value;',
      '}',
    ],
    expectations: [{ kind: 'dead-store-overwrite', snippet: 'value', present: true }],
  },
  {
    name: 'should NOT report dead-store when value is referenced only in an unevaluated destructure default (syntactic read present)',
    fileName: '/virtual/destructure-default-not-evaluated.ts',
    source: [
      'function destructureDefaultNotEvaluated() {',
      '  let value = 1;',
      '  let { a = value } = { a: 2 };',
      '  return 0;',
      '}',
    ],
    expectations: [{ kind: 'dead-store', snippet: 'value', present: false }],
  },
  {
    name: 'should not report a dead-store finding when a value is referenced in a destructuring default that is statically evaluated',
    fileName: '/virtual/destructure-default-evaluated.ts',
    source: ['function destructureDefaultEvaluated() {', '  let value = 1;', '  let { a = value } = {};', '  return 0;', '}'],
    expectations: [{ kind: 'dead-store', snippet: 'value', present: false }],
  },
  {
    name: 'should report a dead-store finding when an initializer is overwritten in a loop that always runs (per CLAUDE.md case 1)',
    fileName: '/virtual/break.ts',
    source: [
      'function breakLoop() {',
      '  let value = 0;',
      '  while (true) {',
      '    value = 1;',
      '    break;',
      '  }',
      '  return value;',
      '}',
    ],
    expectations: [{ kind: 'dead-store', snippet: 'value', present: true }],
  },
  {
    name: 'should report a dead-store finding when a value is read only inside a statically-unreachable loop body',
    fileName: '/virtual/unreachable-loop.ts',
    source: ['function unreachableLoop() {', '  let value = 0;', '  while (false) {', '    value;', '  }', '  return 0;', '}'],
    expectations: [{ kind: 'dead-store', snippet: 'value', present: true }],
  },
  {
    name: 'should not report a dead-store finding when a loop continues early and the value is read after the loop',
    fileName: '/virtual/continue.ts',
    source: [
      'function continueLoop() {',
      '  let value = 0;',
      '  for (let index = 0; index < 1; index += 1) {',
      '    value = 1;',
      '    continue;',
      '  }',
      '  return value;',
      '}',
    ],
    expectations: [{ kind: 'dead-store', snippet: 'value', present: false }],
  },
  {
    name: 'should not report a dead-store finding when a switch case exits via break and the value is read after the switch',
    fileName: '/virtual/switch.ts',
    source: [
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
    ],
    expectations: [{ kind: 'dead-store', snippet: 'value', present: false }],
  },
  {
    name: 'should report a dead-store-overwrite finding when a switch default falls through into a later case and overwrites the write',
    fileName: '/virtual/switch-default-middle-fallthrough.ts',
    source: [
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
    ],
    expectations: [{ kind: 'dead-store-overwrite', snippet: 'result', present: true }],
  },
  {
    name: 'should not report a dead-store-overwrite finding when a switch default exits via break before later cases',
    fileName: '/virtual/switch-default-middle-break.ts',
    source: [
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
    ],
    expectations: [{ kind: 'dead-store-overwrite', snippet: 'result', present: false }],
  },
  {
    name: 'should report a dead-store finding when a value is only referenced in a switch case expression that is unreachable due to an earlier static match',
    fileName: '/virtual/unreachable-switch-case-expression.ts',
    source: [
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
    ],
    expectations: [{ kind: 'dead-store', snippet: 'value', present: true }],
  },
  {
    name: 'should not report a dead-store finding when a value is read in a finally block after a return',
    fileName: '/virtual/finally-read.ts',
    source: [
      'function finallyRead() {',
      '  let value = 1;',
      '  try {',
      '    return 0;',
      '  } finally {',
      '    value;',
      '  }',
      '}',
    ],
    expectations: [{ kind: 'dead-store', snippet: 'value', present: false }],
  },
  {
    name: 'should not report a dead-store finding when a labeled break exits an outer loop and the value is read after the loop',
    fileName: '/virtual/labeled-break.ts',
    source: [
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
    ],
    expectations: [{ kind: 'dead-store', snippet: 'value', present: false }],
  },
  {
    name: 'should not report a dead-store finding when a value is read only on a short-circuit branch',
    fileName: '/virtual/short-circuit-read.ts',
    source: ['function shortCircuitRead(cond: boolean) {', '  let value = 1;', '  cond && value;', '  return 0;', '}'],
    expectations: [{ kind: 'dead-store', snippet: 'value', present: false }],
  },
  {
    name: 'should not report a dead-store finding when a value is read only on a conditional expression branch',
    fileName: '/virtual/conditional-expression-read.ts',
    source: [
      'function conditionalExpressionRead(cond: boolean) {',
      '  let value = 1;',
      '  cond ? value : 0;',
      '  return 0;',
      '}',
    ],
    expectations: [{ kind: 'dead-store', snippet: 'value', present: false }],
  },
  {
    name: 'should report a dead-store finding when a value is only referenced in a never-executed short-circuit branch',
    fileName: '/virtual/short-circuit-never.ts',
    source: ['function shortCircuitNever() {', '  let value = 1;', '  false && value;', '  return 0;', '}'],
    expectations: [{ kind: 'dead-store', snippet: 'value', present: true }],
  },
  {
    name: 'should report a dead-store finding when a value is only referenced in an unreachable if branch',
    fileName: '/virtual/if-unreachable.ts',
    source: ['function ifUnreachable() {', '  let value = 1;', '  if (false) {', '    value;', '  }', '  return 0;', '}'],
    expectations: [{ kind: 'dead-store', snippet: 'value', present: true }],
  },
  {
    name: 'should report a dead-store finding when a value is only referenced in an unreachable conditional expression branch',
    fileName: '/virtual/conditional-unreachable.ts',
    source: ['function conditionalUnreachable() {', '  let value = 1;', '  true ? 0 : value;', '  return 0;', '}'],
    expectations: [{ kind: 'dead-store', snippet: 'value', present: true }],
  },
  {
    name: 'should report a dead-store finding when a value is only referenced in an unreachable branch guarded by 0',
    fileName: '/virtual/if-zero-unreachable.ts',
    source: ['function ifZeroUnreachable() {', '  let value = 1;', '  if (0) {', '    value;', '  }', '  return 0;', '}'],
    expectations: [{ kind: 'dead-store', snippet: 'value', present: true }],
  },
  {
    name: 'should report a dead-store finding when a value is only referenced in an unreachable branch guarded by an empty string',
    fileName: '/virtual/if-empty-string-unreachable.ts',
    source: ['function ifEmptyStringUnreachable() {', '  let value = 1;', "  if ('') {", '    value;', '  }', '  return 0;', '}'],
    expectations: [{ kind: 'dead-store', snippet: 'value', present: true }],
  },
  {
    name: 'should not report a dead-store finding when a value is referenced in a reachable branch guarded by 1',
    fileName: '/virtual/if-one-reachable.ts',
    source: ['function ifOneReachable() {', '  let value = 1;', '  if (1) {', '    value;', '  }', '  return 0;', '}'],
    expectations: [{ kind: 'dead-store', snippet: 'value', present: false }],
  },
  {
    name: 'should report a dead-store finding when a value is only referenced in an unreachable branch guarded by 0n',
    fileName: '/virtual/if-bigint-zero-unreachable.ts',
    source: ['function ifBigintZeroUnreachable() {', '  let value = 1;', '  if (0n) {', '    value;', '  }', '  return 0;', '}'],
    expectations: [{ kind: 'dead-store', snippet: 'value', present: true }],
  },
  {
    name: 'should report a dead-store finding when a value is only referenced in an unreachable branch guarded by void 0',
    fileName: '/virtual/if-void-zero-unreachable.ts',
    source: [
      'function ifVoidZeroUnreachable() {',
      '  let value = 1;',
      '  if (void 0) {',
      '    value;',
      '  }',
      '  return 0;',
      '}',
    ],
    expectations: [{ kind: 'dead-store', snippet: 'value', present: true }],
  },
];


const matchesExpectation = (findings: ReadonlyArray<WasteFinding>, expectation: WasteExpectation): boolean => {
  return findings.some(finding => finding.kind === expectation.kind && finding.label.includes(expectation.snippet));
};

describe('detector', () => {
  it.each(cases)('$name', testCase => {
    const program = createProgram(testCase.fileName, testCase.source.join('\n'));
    const findings = detectWaste(program);
    const actual = testCase.expectations.map(expectation => matchesExpectation(findings, expectation));
    const expected = testCase.expectations.map(expectation => expectation.present);

    expect(actual).toEqual(expected);
  });
});
