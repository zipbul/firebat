// DEAD: the IIFE body is analyzed as its own scope, so a genuine dead store
// inside it is still reported. `local = 1` is overwritten by `local = 2`
// before any read.
export const r = ((): number => {
  let local = 1;
  local = 2;

  return local;
})();
