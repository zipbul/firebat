// case 5 변형: finally 블록의 명시적 null 할당 (GC hint)
// 'resource = null'은 함수 종료 직전이라 read되지 않음.
// 정책: 모던 V8에서 명시 null은 GC에 무의미. 정의대로 dead-store로 잡는다.

export async function withResource(): Promise<number> {
  let resource: { read: () => number; close: () => void } | null = null;

  try {
    resource = { read: () => 42, close: () => {} };

    return resource.read();
  } finally {
    if (resource) {
      resource.close();
    }

    resource = null;
  }
}
