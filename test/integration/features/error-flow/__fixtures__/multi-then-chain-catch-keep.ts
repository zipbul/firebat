// K — a multi-stage then chain that terminates in `.catch` IS handled;
// catch-or-return must not fire even with intermediate `.then` stages.
export function run(p: Promise<number>): void {
  p.then((x) => x + 1)
    .then((y) => y * 2)
    .catch((e) => console.error(e));
}
