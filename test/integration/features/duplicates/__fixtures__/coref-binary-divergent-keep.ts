// 같은 노드 구조(BinaryExpression +)지만 바인딩 동일참조(co-reference)가 다르다:
// a+a(한 바인딩 재사용) vs a+b(서로 다른 두 바인딩) → 다른 결정 → 비보고(keep).
function doubleFirst(a: number, b: number): number {
  return a + a;
}

function sumBoth(a: number, b: number): number {
  return a + b;
}
