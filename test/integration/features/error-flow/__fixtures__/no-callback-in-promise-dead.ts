// no-callback-in-promise (syntactic): a node-style callback API used inside a .then handler.
// The chain is returned and has a .catch, so neither catch-or-return nor floating-promises fire —
// isolating the no-callback-in-promise finding.
declare const fs: { readFile(p: string, cb: (e: unknown, d: unknown) => void): void };

export function dead(p: Promise<void>): Promise<void> {
  return p
    .then(() => {
      fs.readFile('a', (_e, _d) => {});
    })
    .catch(() => {});
}

// K: a .then whose handler uses no node-style callback (returned + caught, so no other rule fires).
export function keep(p: Promise<void>): Promise<void> {
  return p.then(r => r).catch(() => {});
}
