// W (guard): two methods writing the SAME private field `#x` with identical bodies
// ARE a real clone — the private field is verbatim-identical, so the normal forms
// match. The fix (stop substituting `#names`) must keep this reported.
class Ctx {
  #x = 0;

  setA(v: number): void {
    this.#x = v;
  }

  setB(v: number): void {
    this.#x = v;
  }
}

export const _use = Ctx;
