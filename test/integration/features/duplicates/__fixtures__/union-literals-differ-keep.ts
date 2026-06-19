// K: 같은 구조(N-arm 문자열 union)지만 리터럴이 다르다 → 다른 결정.
// 타입 선언 본문의 리터럴은 결정 그 자체 — 치환하면 arity만으로 충돌(FP).
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type TraceKind = 'enter' | 'exit' | 'call' | 'return';
