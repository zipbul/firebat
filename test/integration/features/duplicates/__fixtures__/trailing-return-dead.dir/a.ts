export function setup(opts: { name: string }): void {
  const tag = opts.name.trim();
  register(tag);
  warm(tag);
  return;
}
