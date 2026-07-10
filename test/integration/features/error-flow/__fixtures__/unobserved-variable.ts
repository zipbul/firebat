// unobserved-variable (gildash-gated; asserted real-typed in semantic.test.ts, not in this degraded golden)
export async function unobservedFetch() {
  const p = fetch('/api');
  console.log('done');
}

// Should NOT flag: awaited
export async function awaitedFetch() {
  const p = fetch('/api');
  await p;
}

// catch-or-return (syntactic — the finding THIS golden pins): a spec-fact Promise chain with a
// .then and no .catch. (An arbitrary variable receiver needs a gildash proof — unit-tested.)
export async function thenFetch() {
  Promise.resolve('/api').then(r => console.log(r));
}

// Should NOT flag: returned
export async function returnedFetch() {
  const p = fetch('/api');
  return p;
}

// Should NOT flag: passed as argument
export async function passedAsArg() {
  const p = fetch('/api');
  handle(p);
}

declare function handle(p: Promise<Response>): void;
