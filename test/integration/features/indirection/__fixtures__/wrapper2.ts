// wrapper2: non-export single-file delegate.
function math(x: number): number {
  return x * 3;
}

// W — bare passthrough, non-export.
function calculate(x: number): number {
  return math(x);
}

calculate(1);
