// K: 같은 바깥 형태(ReadonlyMap)지만 타입인자가 다르다 → 다른 계약.
// 타입 선언 본문의 타입인자는 결정 그 자체 — 치환하면 무관한 별칭이 충돌(FP).
type FunctionRangeMap = ReadonlyMap<string, ReadonlyArray<FunctionRange>>;

type WorkspacePackages = ReadonlyMap<string, string>;
