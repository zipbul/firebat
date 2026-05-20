// case 6: 외부로 escape 안 하는 누적 변수
// 'collected'는 push만 되고 return/closure/외부 호출 어디에서도 그 값이 흐르지 않음.
// 변수 + push 루프 전체가 관찰 가능한 동작에 기여하지 않음.
//
// TODO(escape-analysis): expected는 현재 `[]` (미구현). escape 분석 구현 후
// 다음과 같은 finding으로 갱신되어야 한다:
//   { kind: 'dead-store', label: 'collected', ... line 6 'collected' identifier ... }

export function track(events: { type: string }[]): number {
  const collected: string[] = [];

  for (const event of events) {
    collected.push(event.type);
  }

  return events.length;
}
