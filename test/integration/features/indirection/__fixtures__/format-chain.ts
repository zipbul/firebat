// format-chain: non-export single-file two-hop chain (display → format → String).
// `String` is a free global identifier (passes ①) but not a tracked wrapper, so
// format.depth=1, display.depth=2.
function format(n: number): string {
  return String(n);
}

function display(n: number): string {
  return format(n);
}

display(1);
