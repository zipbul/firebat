// thin-wrapper: non-export single-file delegate (② closes in-file).
function core(x: number): number {
  return x * 2;
}

// W — bare passthrough, non-export, used only by direct call below.
function wrapper(x: number): number {
  return core(x);
}

wrapper(1);
