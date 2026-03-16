// Fixture: nested function — inner function return should not leak to outer
export function outer(x: boolean): string {
  const inner = (y: boolean): string => {
    if (!y) {
      return 'inner-false';
    }

    return 'inner-true';
  };

  if (!x) {
    return 'outer-false';
  }

  return inner(x);
}
