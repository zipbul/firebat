// K: 구조 같고 판별 리터럴만 다른 서로 다른 결정 — 합쳐선 안 된다.
export function isGodModule(c: { kind: string }): boolean {
  return c.kind === 'god-module';
}
