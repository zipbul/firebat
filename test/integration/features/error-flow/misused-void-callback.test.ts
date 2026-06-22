import { describe, expect, it } from 'bun:test';

import { type KindCase, errorFlowKindsFor, itEachFlagsKind, itEachKeepsKind } from './error-flow-kit';

// The void-callback-arg case of misused-promises (typescript-eslint no-misused-promises /
// voidReturnArgument): an async (Promise-returning) callback passed into a parameter slot whose
// contextual type returns void discards the rejection at the call boundary. Implemented via the
// oracle's expectsVoidReturningCallback (gildash 0.34.0). Behaviour-level (code -> W/K): the W cases
// flag, the K cases are the guard rails.

describe('integration/error-flow — misused-promises void-callback-arg (real typed gildash)', () => {
  const flaggedCases: KindCase[] = [
    {
      name: 'flags an async callback passed to a user-defined void-returning parameter',
      code: [
        'function run(cb: () => void): void { cb(); }',
        'declare function flush(): Promise<void>;',
        'export function f(): void {',
        '  run(async () => { await flush(); });',
        '}',
      ].join('\n'),
    },
    {
      name: 'flags an async callback passed to an optional void-returning parameter',
      code: [
        'function run(cb?: () => void): void { cb?.(); }',
        'declare function flush(): Promise<void>;',
        'export function f(): void {',
        '  run(async () => { await flush(); });',
        '}',
      ].join('\n'),
    },
    {
      name: 'flags an async callback passed to a rest void-returning parameter',
      code: [
        'function each(...cbs: Array<() => void>): void { for (const c of cbs) c(); }',
        'declare function a(): Promise<void>;',
        'export function f(): void {',
        '  each(async () => { await a(); });',
        '}',
      ].join('\n'),
    },
  ];
  const keptCases: KindCase[] = [
    {
      name: 'does not flag when the parameter slot accepts a thenable return',
      code: [
        'function run(cb: () => void | Promise<void>): void { void cb(); }',
        'declare function flush(): Promise<void>;',
        'export function f(): void {',
        '  run(async () => { await flush(); });',
        '}',
      ].join('\n'),
    },
    {
      name: 'does not flag when the parameter slot expects a Promise return',
      code: [
        'function run(cb: () => Promise<void>): Promise<void> { return cb(); }',
        'declare function flush(): Promise<void>;',
        'export function f(): Promise<void> {',
        '  return run(async () => { await flush(); });',
        '}',
      ].join('\n'),
    },
    {
      name: 'does not flag a callback whose async result is explicitly voided',
      code: [
        'function run(cb: () => void): void { cb(); }',
        'declare function flush(): Promise<void>;',
        'export function f(): void {',
        '  run(() => void flush());',
        '}',
      ].join('\n'),
    },
    {
      name: 'does not flag a synchronous callback in a void-returning slot',
      code: [
        'function run(cb: () => void): void { cb(); }',
        'declare function compute(): number;',
        'export function f(): void {',
        '  run(() => { compute(); });',
        '}',
      ].join('\n'),
    },
    {
      name: 'does not flag when overload resolution selects a Promise-accepting signature',
      code: [
        "declare function on(ev: 'a', cb: () => void): void;",
        "declare function on(ev: 'b', cb: () => Promise<void>): void;",
        'declare function flush(): Promise<void>;',
        'export function f(): void {',
        "  on('b', async () => { await flush(); });",
        '}',
      ].join('\n'),
    },
  ];

  itEachFlagsKind(flaggedCases, 'misused-promises');

  itEachKeepsKind(keptCases, 'misused-promises');
});
