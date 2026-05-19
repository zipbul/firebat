// case 4: try/catch 양쪽이 초기값을 덮음
// 초기 'value = 0'은 어떤 경로에서도 read되지 않음 — try 성공 시 readFast,
// 실패 시 catch가 readFallback으로 덮음. TS는 try/catch 양 분기 할당을
// definite assignment로 인정하므로 'let value: number'로 충분하다.

declare function readFast(): number;
declare function readFallback(): number;

export function readWithFallback(): number {
  let value = 0;

  try {
    value = readFast();
  } catch {
    value = readFallback();
  }

  return value;
}
