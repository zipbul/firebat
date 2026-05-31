// unsafe-finally (block form, syntactic): a finally that returns/breaks masks the try's outcome.
export function returns(): number {
  try {
    return 1;
  } finally {
    return 2;
  }
}

// K: a finally that only cleans up (no throw/return/break/continue) does not mask anything.
export function cleanupOnly(): number {
  try {
    return compute();
  } finally {
    log('done');
  }
}

declare function compute(): number;
declare function log(m: string): void;
