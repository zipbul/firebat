// case 7: 외부로 escape 안 하는 객체 변수
// 'state'는 property write만 일어나고 return/closure/외부 호출 어디에서도 안 흐름.
// 변수 + property write 전체가 관찰 가능한 동작에 기여하지 않음.
//
// TODO(escape-analysis): expected는 현재 `[]` (미구현). escape 분석 구현 후
// 다음과 같은 finding으로 갱신되어야 한다:
//   { kind: 'dead-store', label: 'state', ... line 6 'state' identifier ... }

export function buildState(): void {
  const state = { count: 0 };

  state.count = 42;
}
