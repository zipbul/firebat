# TODO

## waste detector — case 6/7 escape 분석 구현

case 6 (escape 안 하는 누적 변수) 와 case 7 (escape 안 하는 객체 변수)는 detector 미구현 상태:
- `test/integration/features/waste/__fixtures__/no-escape-accumulator.ts` — expected `[]` (잠금)
- `test/integration/features/waste/__fixtures__/no-escape-object.ts` — expected `[]` (잠금)

escape 분석 모듈 신규 필요:
1. 변수 use를 분류 (real read / mutation method receiver / property write target / escape)
2. escape 추적 (return / closure capture / 외부 호출 인자 / alias 전파)
3. mutation method whitelist (push/pop/shift/unshift/splice/sort/reverse/fill/copyWithin/set/add/delete/clear)
4. 변수의 모든 use가 mutation-only이고 escape 없으면 dead → 변수 선언 + 모든 write 제거 권장

구현 후 위 두 fixture의 expected JSON을 다음 형태로 갱신:
- `{ kind: 'dead-store', label: 'collected'|'state', ... 변수 declaration identifier span ... }`

## duplicates detector — jscpd 비교 및 개선

**참고**: https://github.com/kucherenko/jscpd (중복 코드 탐지 패키지)

수행 작업:
1. jscpd 알고리즘 조사 — token-based / AST-based / hash-based, threshold 옵션, 지원 언어, 출력 포맷
2. firebat duplicates detector 현 동작 분석 — 어떤 패턴 잡고 어떤 패턴 놓치는지
3. 차이점 정리 — jscpd 우위 / firebat 우위
4. firebat 개선안 — jscpd 강점 흡수 + firebat 차별화 (TypeScript 특화, AST 의미 기반 비교, type-aware 비교 등)

다음 duplicates 작업 시작 전 위 4단계 먼저 처리.
