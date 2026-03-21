async function load(modulePath: string) {
  const mod = await import(modulePath);
  return mod;
}
