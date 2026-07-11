// KEEP (private-field bug repro): two methods write DIFFERENT private fields
// (`#renderer` vs `#status`). A PrivateIdentifier is a property name, not a binding —
// the spec forbids substituting property names ("프로퍼티 이름은 치환하지 않고 그대로 비교").
// Merging units that touch different `#fields` asserts a shared change-point that
// does not exist → K.
class Ctx {
  #renderer = 0;
  #status = 0;

  setRenderer(v: number): void {
    this.#renderer = v;
  }

  setStatus(v: number): void {
    this.#status = v;
  }
}

export const _use = Ctx;
