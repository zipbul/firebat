// case 7: 외부로 escape 안 하는 객체 변수
// 'state'는 property write만 일어나고 return/closure/외부 호출 어디에서도 안 흐름.
// 변수 + property write 전체가 관찰 가능한 동작에 기여하지 않음.
// classifyUseInWaste: `state.count = 42` → 'property-write' → meaningful=false → dead.

export function buildState(): void {
  const state = { count: 0 };

  state.count = 42;
}
