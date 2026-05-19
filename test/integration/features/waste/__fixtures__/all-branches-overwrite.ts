// case 2: 선언 시 초기값이 모든 후속 분기에서 덮임
// 'pending'은 어떤 경로에서도 read되지 않음 (if/else 양쪽이 status를 덮음).

export function loadConfig(input: string): { status: string } {
  let status: string = 'pending';

  if (input.length > 0) {
    status = 'ready';
  } else {
    status = 'failed';
  }

  return { status };
}
