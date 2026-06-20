// K: void 위임 — 파라미터를 그대로 단일 호출에 넘기고 반환값을 버린다.
// 결정 없는 골격(`return f(x)`와 같은 부류, 문장 본문 형태)이므로 보고 금지.
function forwardA(x: number): void {
  sink(x);
}

function forwardB(x: number): void {
  sink(x);
}
