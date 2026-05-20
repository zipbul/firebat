// KEEP boundary: `Object.assign(target, source)` enumerates `source` and
// reads each own property. A getter on `source` fires at copy time — observable
// side-effect. classifyUseInWaste rejects any target-mutation-API source whose
// ObjectExpression literal carries a getter/setter, regardless of body purity.

export function f(): void {
  const o: { x?: number } = {};

  Object.assign(o, {
    get x() {
      console.log('g');

      return 1;
    },
  });
}
