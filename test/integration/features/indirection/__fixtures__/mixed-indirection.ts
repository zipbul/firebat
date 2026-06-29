// mixed-indirection: thin-wrapper + type-remap + interface-rewrap in one file.
// `export {}` makes this a module (required for interface-rewrap).
export {};

// W — non-export thin-wrapper, no identity-position use.
function wrapper(x: any) { return target(x); }
function target(x: any) { return x + 1; }

wrapper(1);

type Alias = Original; // W — pure synonym, no type args/params
interface Empty extends Base {} // W — empty body, single non-generic extends, module
