// Should flag: fetch() result never awaited
export async function unobservedFetch() {
  const p = fetch('/api');
  console.log('done');
}

// Should NOT flag: awaited
export async function awaitedFetch() {
  const p = fetch('/api');
  await p;
}

// Should NOT flag: .then()
export async function thenFetch() {
  const p = fetch('/api');
  p.then(r => console.log(r));
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
