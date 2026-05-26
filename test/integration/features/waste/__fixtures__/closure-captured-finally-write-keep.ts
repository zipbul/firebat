// KEEP boundary: a flag captured by a closure created before a finally-block
// write. `cb` (created at declaration) reads `isSync`; it escapes (returned)
// and may be invoked asynchronously after the finally sets isSync=false. So
// the finally write is observable. Detected via the offset rule: a capturing
// closure's source start precedes the def location. (Found in jotai.)
export function f(run: (cb: () => void) => void): () => void {
  let isSync = true;

  const cb = (): void => {
    if (!isSync) {
      run(cb);
    }
  };

  try {
    run(cb);
  } finally {
    isSync = false;
  }

  return cb;
}
