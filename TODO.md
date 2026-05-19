# TODO

## duplicates detector — jscpd 비교 및 개선

**참고**: https://github.com/kucherenko/jscpd (중복 코드 탐지 패키지)

수행 작업:
1. jscpd 알고리즘 조사 — token-based / AST-based / hash-based, threshold 옵션, 지원 언어, 출력 포맷
2. firebat duplicates detector 현 동작 분석 — 어떤 패턴 잡고 어떤 패턴 놓치는지
3. 차이점 정리 — jscpd 우위 / firebat 우위
4. firebat 개선안 — jscpd 강점 흡수 + firebat 차별화 (TypeScript 특화, AST 의미 기반 비교, type-aware 비교 등)

다음 duplicates 작업 시작 전 위 4단계 먼저 처리.
