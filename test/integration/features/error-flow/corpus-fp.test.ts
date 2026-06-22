import { describe, expect, it } from 'bun:test';

import { errorFlowKindsFor, itEachKeepsKind } from './error-flow-kit';

// False positives found by scanning real open-source code (ky, etc.) with a real-typed gildash.

interface CauseCase {
  readonly name: string;
  readonly code: string;
}

describe('corpus FP — missing-error-cause: cause value behind a TS cast (ky Ky.ts:979)', () => {
  const keptCases: CauseCase[] = [
    {
      name: 'does NOT flag `{ cause: error as Error }` (the cast still forwards the caught error)',
      code: [
        'class NetworkError extends Error { constructor(req: unknown, opts?: ErrorOptions) { super("net", opts); } }',
        'export function f(req: unknown): void {',
        '  try { work(); } catch (error) { throw new NetworkError(req, { cause: error as Error }); }',
        '}',
        'declare function work(): void;',
      ].join('\n'),
    },
    {
      name: 'does NOT flag `{ cause: error! }` (non-null assertion)',
      code: [
        'export function f(): void {',
        '  try { work(); } catch (error) { throw new Error("x", { cause: error! }); }',
        '}',
        'declare function work(): void;',
      ].join('\n'),
    },
  ];

  itEachKeepsKind(keptCases, 'missing-error-cause');

  it('guard: still flags when the cause is a DERIVED value behind a cast, not the error', async () => {
    const code = [
      'export function f(): void {',
      '  try { work(); } catch (error: any) { throw new Error("x", { cause: error.inner as Error }); }',
      '}',
      'declare function work(): void;',
    ].join('\n');

    expect(await errorFlowKindsFor(code)).toContain('missing-error-cause');
  });
});
