// 바인딩만 다르고 동일참조 구조가 같다(둘 다 첫 파라미터를 두 번 사용) → alpha-equivalent →
// 정규형 일치 → 보고(dead). co-reference 도입이 정상 rename 클론을 깨지 않음을 고정한다.
function doubleFirst(a: number, b: number): number {
  return a + a;
}

function doubleLead(c: number, d: number): number {
  return c + c;
}
