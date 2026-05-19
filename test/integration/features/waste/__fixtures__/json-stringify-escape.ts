// KEEP boundary (case 7의 반례): 객체가 JSON.stringify로 reflection read 후 return
// 'payload'는 property write만 직접 일어나지만 JSON.stringify가 모든 field를 read하고
// 결과 string이 return으로 escape.

export function serialize(): string {
  const payload: Record<string, unknown> = {};

  payload.id = 1;
  payload.name = 'alice';

  return JSON.stringify(payload);
}
