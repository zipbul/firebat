// case 1 변형: switch fallthrough로 인한 overwrite
// kind === 1일 때 'label = "low"' 후 break 없이 case 2로 떨어져 'label = "medium"'이 덮음.
// "low"는 어떤 경로에서도 read되지 않음.
// 정책: 의도된 fallthrough라도 정의상 dead-store로 잡는다.

export function classify(kind: number): string {
  let label = '';

  switch (kind) {
    case 1:
      label = 'low';
    // fallthrough
    case 2:
      label = 'medium';
      break;
    case 3:
      label = 'high';
      break;
  }

  return label;
}
