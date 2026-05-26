// DEAD: a function declared inside a namespace is its own scope — its locals are
// ordinary analyzable variables, not namespace members. The dead-store on `x`
// is still reported (the namespace exemption resets at function boundaries).
export namespace N {
  export function f(): number {
    let x = 1;
    x = 2;

    return x;
  }
}
