// case 1 (module-scope): `value = 1` initializer overwritten before read.
// CLAUDE.md: "모든 scope (module / function / block)" 대상.

let value = 1;
value = 2;

console.log(value);
