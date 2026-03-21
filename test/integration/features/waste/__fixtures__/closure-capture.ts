// closure-capture: closure captured variable skip + destructuring dead-store + overwrite chain

export function closureCapture(): () => number {
  let counter = 0;

  return () => {
    counter += 1;
    return counter;
  };
}

export function destructuringDeadStore(): string {
  const { name, _unused } = { name: 'hello', _unused: 'skip' };
  return name;
}

export function overwriteChain(): number {
  let value = 1;
  value = 2;
  value = 3;
  return value;
}
