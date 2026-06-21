// K: 두 루프의 구조는 같지만 호출하는 로컬 함수가 다르다 — 다른 대상 호출 = 다른 결정.
// callee가 비교 단위(run) 밖에서 선언된 자유 참조이므로 치환하지 않고 verbatim 비교한다.
function driveA(nodes: number[]): void {
  const stepA = (n: number): void => { recordA(n); };
  for (const node of nodes) {
    stepA(node);
  }
}
