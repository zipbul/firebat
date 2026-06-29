// direct-util: non-export single-file thin-wrapper forwarding to a free function.
function directUtil(s: string): string {
  const trimmed = s.trim();

  return trimmed.toLowerCase();
}

// W — bare passthrough to a free function identifier.
function clean(s: string): string {
  return directUtil(s);
}

clean('x');
