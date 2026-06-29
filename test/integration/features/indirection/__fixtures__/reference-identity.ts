// reference·identity gate (②): same delegate shape — W only when used solely in
// direct-call position; any other reach (callback/===/new/return/export/alias) → K.
function f(x: number): number { return x; }

// W — used only as a direct call.
function wDirect(x: number): number { return f(x); }
wDirect(1);

// K — reaches a callback position (CallExpression argument).
const cbMap = (x: number): number => f(x);
[1].map(cbMap);

// K — reaches an === operand.
const cbEq = (x: number): number => f(x);
const sameRef: boolean = cbEq === f;
log(sameRef);

// K — reaches a NewExpression argument.
const cbNew = (x: number): number => f(x);
new Set([cbNew]);

// K — fixpoint alias then callback position.
const cbBase = (x: number): number => f(x);
const cbAlias = cbBase;
[2].map(cbAlias);

declare function log(v: unknown): void;
