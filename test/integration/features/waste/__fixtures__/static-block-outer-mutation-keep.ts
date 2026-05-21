// KEEP boundary: a class expression's `static { ... }` block executes while
// evaluating the class definition. A reference to an outer fresh binding
// inside the static block mutates that binding at evaluation time —
// observable side-effect. buildVarHasMeaningfulUse now treats any usage
// whose ancestor chain includes a StaticBlock as a meaningful read.

export function f(): void {
  const c: number[] = [];

  class C {
    static {
      c.push(1);
    }
  }

  void C;
}
