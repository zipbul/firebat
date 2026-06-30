// argument-transform (①), async/generator (④), narrowing return (⑤),
// accessor (⑥) gates — all K.
function tgt(x: number): number { return x; }
function tgt2(a: number, b: number): number { return a + b; }

// K — optional-chain call (short-circuit decision).
const wOpt = (x: number): number | undefined => tgt?.(x);

// K — non-rest positional spread.
function wSpread(x: [number]): number { return tgt(...x); }

// K — literal injection (extra argument).
function wLit(x: number): number { return tgt2(x, 1); }

// K — async/await delegation (error-flow).
async function wAsync(x: number): Promise<number> { return await Promise.resolve(tgt(x)); }

// K — generator delegation.
function* wGen(x: number): Generator<number> { yield* [tgt(x)]; }

// K — type-predicate return (narrowing lost on inline).
function wPred(v: unknown): v is number { return typeof v === 'number'; }

// K — get/set accessor (call site is property access, not a call).
class Box {
  private inner = 0;
  get value(): number { return identity(this.inner); }
  set value(n: number) { identity(n); }
}

function identity(n: number): number { return n; }

void wOpt; void wSpread; void wLit; void wAsync; void wGen; void wPred; void Box;
