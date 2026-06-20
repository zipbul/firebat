// K: 두 함수가 공유하는 건 단일 계산 문장 하나뿐 (문장 덩어리=run이 아님 → 비대상).
function buildA(base: number): number {
  warmA();
  const result = (base * factor + offset) / divisor - adjustment + correction * weight;
  return result;
}
