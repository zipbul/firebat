// param-patterns: destructured params forwarding, rest params forwarding, await forwarding

declare function processUser(name: string, age: number): void;
declare function log(...args: unknown[]): void;
declare function fetchRemote(url: string): Promise<string>;

export function destructuredForward({ name, age }: { name: string; age: number }): void {
  return processUser(name, age);
}

export function restForward(...args: unknown[]): void {
  return log(...args);
}

export async function awaitForward(url: string): Promise<string> {
  return await fetchRemote(url);
}
