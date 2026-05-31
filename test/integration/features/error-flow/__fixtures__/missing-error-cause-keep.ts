// missing-error-cause K cases — every throw preserves the caught error's cause, so none flag.
// The cause check is syntactic, so this holds under the degraded golden gildash.

// K: new Error with { cause }
export function withCause(): void {
  try {
    work();
  } catch (e) {
    throw new Error('wrapped', { cause: e });
  }
}

// K: bare rethrow of the original
export function rethrow(): void {
  try {
    work();
  } catch (e) {
    log(e);
    throw e;
  }
}

// K: cause assigned onto the new error before throw
export function assignCause(): void {
  try {
    work();
  } catch (e) {
    const err = new Error('wrapped');
    (err as { cause?: unknown }).cause = e;
    throw err;
  }
}

// K: reassign the catch param to a cause-preserving new error (FP-A regression guard)
export function reassignWithCause(): void {
  try {
    work();
  } catch (e: unknown) {
    e = new Error('wrapped', { cause: e });
    throw e;
  }
}

// K: a dead block-scoped const shadows the name; `throw e` is still the original (FP-B regression guard)
export function shadowedBlock(): void {
  try {
    work();
  } catch (e) {
    {
      const e = new Error('dead-nested');
      void e;
    }
    throw e;
  }
}

declare function work(): void;
declare function log(e: unknown): void;
