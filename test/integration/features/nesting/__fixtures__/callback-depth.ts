// callback-depth: 3+ nested callback chain — triggers callback-depth finding (threshold: 3)

export function deepCallbacks(items: string[]): void {
  items.forEach((item) => {
    [1, 2].map((n) => {
      [true, false].filter((b) => {
        ['a'].find((s) => {
          console.log(item, n, b, s);
          return true;
        });
        return b;
      });
      return n;
    });
  });
}
