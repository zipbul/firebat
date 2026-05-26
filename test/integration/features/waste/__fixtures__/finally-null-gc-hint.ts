// finally 블록의 명시적 null 할당 (GC hint). 마지막 `resource = null`은 함수
// 종료 직전이라 read되지 않아 dead-store로 잡힌다.
//
// 선두 `let resource = null` init은 보수적 KEEP: try-body 할당 전에 throw가 나면
// init null이 살아 finally의 `if (resource)`로 읽힌다. reaching-defs가 exception
// edge로 init을 그 read까지 전파하므로 "사용됨"으로 본다. (null/undefined가
// truthiness 동치라 이론상 제거 가능하나, 흔한 방어 패턴
// `let x = fallback; try { x = f() } catch {}; use x`의 false positive를 막는 것이
// 우선이라 정밀도를 양보.)

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
