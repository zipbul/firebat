function* alpha(xs: number[]): Generator<number> {
  primeAlpha();
  const computed = aggregate(xs);
  yield computed;
  const adjusted = computed + 1;
  emit(adjusted);
}

function* bravo(ys: number[]): Generator<number> {
  primeBravo();
  const computed = aggregate(ys);
  yield computed;
  const adjusted = computed + 1;
  emit(adjusted);
}
