// case 6: 외부로 escape 안 하는 누적 변수
// 'collected'는 push만 되고 return/closure/외부 호출 어디에서도 그 값이 흐르지 않음.
// 변수 + push 루프 전체가 관찰 가능한 동작에 기여하지 않음.
// classifyUseInWaste: `collected.push(...)` → 'mutation' (whitelisted) → meaningful=false → dead.

export function track(events: { type: string }[]): number {
  const collected: string[] = [];

  for (const event of events) {
    collected.push(event.type);
  }

  return events.length;
}
