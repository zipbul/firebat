// param-patterns: destructured params (K), rest params (W), await forwarding (K).
// Non-export single-file so the reference-identity gate (②) closes in-file.

declare function processUser(name: string, age: number): void;
declare function log(...args: unknown[]): void;
declare function fetchRemote(url: string): Promise<string>;

// K — destructuring a pattern param is an object↔positional transform (spec ①).
function destructuredForward({ name, age }: { name: string; age: number }): void {
  return processUser(name, age);
}

// W — rest forwarded as `...args` with no transform.
function restForward(...args: unknown[]): void {
  return log(...args);
}

// K — async/await delegation belongs to error-flow (spec ④).
async function awaitForward(url: string): Promise<string> {
  return await fetchRemote(url);
}

destructuredForward({ name: 'x', age: 1 });
restForward(1, 2);
void awaitForward('u');
