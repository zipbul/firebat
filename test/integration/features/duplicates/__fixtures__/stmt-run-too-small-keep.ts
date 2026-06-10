function logA(x: number): number {
  console.log(x);
  return x + computeAlpha(x);
}

function logB(y: number): number {
  console.log(y);
  return y - computeBeta(y);
}
