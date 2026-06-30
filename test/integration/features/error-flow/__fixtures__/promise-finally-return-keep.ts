// K — a `.finally` callback that returns a value (not a throw) is harmless;
// the returned value is ignored, no error-flow distortion.
export function run(p: Promise<number>): Promise<number> {
  return p.finally(() => {
    return 42;
  });
}
