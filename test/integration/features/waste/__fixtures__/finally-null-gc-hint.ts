// KEEP (FP-A): finally 블록의 `resource = null`은 참조 해제 / GC hint. 해제된 참조가
// 외부(같은 객체를 잡은 leak detector)에서 관찰되는지 정적 판정 불가하므로, 빈 값으로의
// 재할당(`= null` / `= undefined` / `= void …`)은 lifetime 관리로 보고 절대 보고하지
// 않는다 (CLAUDE.md K "자원 핸들 lifetime"). 진짜 dead한 로컬 clear의 미검출은,
// 매우 흔한 leak-detector / GC-release 관용구(ky·jotai·trpc)의 0-FP를 위해 의도적으로
// 양보한 recall 손실이다.
//
// 선두 `let resource = null` init도 KEEP: try-body 할당 전 throw 시 init null이
// finally의 `if (resource)` read까지 살아남는다.

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
