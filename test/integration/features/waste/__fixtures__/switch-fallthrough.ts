// case 1 변형: switch fallthrough로 인한 overwrite.
// kind === 1일 때 'label = "low"' 후 break 없이 case 2로 떨어져 'label = "medium"'이 덮음.
// "low"는 어떤 경로에서도 read되지 않으므로 dead-store-overwrite로 잡힌다 (label='low').
//
// 선두 `let label = ''` init은 잡지 않는다: switch에 default가 없어 kind가 1/2/3 중
// 어느 것도 아니면 어떤 case도 실행되지 않고 init ''가 그대로 `return label`로 읽힌다
// (CFG가 default 없는 switch의 no-match → after-switch 경로를 모델링). init 제거 시
// TS definite-assignment도 깨지므로 비대상.

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
