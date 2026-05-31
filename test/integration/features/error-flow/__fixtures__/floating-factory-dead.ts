// floating-promises (syntactic factory forms): import() and new Promise discarded at statement level.
export function f(): void {
  import('./side-effect');
  new Promise<void>(resolve => resolve());
}
