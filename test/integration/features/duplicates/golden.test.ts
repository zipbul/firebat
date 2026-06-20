import { describe } from 'bun:test';

import { analyzeDuplicates } from '../../../../src/test-api';
import { runGolden } from '../../shared/golden-runner';

describe('golden/duplicates', () => {
  // minSize 1: 크기 임계로 케이스가 공허하게 통과(vacuous pass)하는 것을 차단하고
  // 모든 판정이 개념 규칙(정규형·골격·비대상)에서만 나오도록 고정한다.
  const rg = (name: string) => runGolden(import.meta.dir, name, program => analyzeDuplicates(program, { minSize: 1 }));
  // statement-run 케이스는 현실적 최소 크기(noise floor)에서 판정한다 — 사소한 1~2문 run을
  // 임계로 거르고, 추출 안전성·자유식별자·중첩 규칙이 실제로 검증되도록 한다.
  const rgFrag = (name: string) => runGolden(import.meta.dir, name, program => analyzeDuplicates(program, { minSize: 12 }));

  // ════════════════════════════════════════════════════════════════════════
  // W — 결정을 담은 구문 + 정규형 일치 → 보고해야 한다 (CLAUDE.md 판정 절차)
  // ════════════════════════════════════════════════════════════════════════

  rg('exact-identical-fn-dead'); // Type-1: 동일 함수
  rg('rename-bound-vars-dead'); // 바인딩(파라미터·지역) 치환 → 정규형 일치
  rgFrag('literal-variant-keep'); // K: 리터럴 비치환 — 리터럴만 다르면 다른 결정 (literal-variant 비탐지). realistic floor에서 판정
  rg('type-variant-dead'); // 타입 주석 치환 → 정규형 일치
  rg('type-param-rename-dead'); // 타입파라미터 치환 → 정규형 일치
  rgFrag('mixed-id-literal-keep'); // K: 바인딩은 치환해도 리터럴은 보존 — 리터럴 다르면 다른 결정
  rgFrag('discriminant-predicate-keep'); // K: 판별 리터럴만 다른 서로 다른 술어 (literal-variant FP 제거)
  rg('identical-class-dead'); // 동일 클래스 → 단일 그룹 (메서드 subsume)
  rg('method-across-classes-dead'); // 클래스는 달라도 메서드 단위 중복은 W
  rg('arrow-fn-dead'); // arrow function도 선언 단위 대상
  rg('same-file-dead'); // "두 곳 이상"은 같은 파일 안도 포함
  rg('three-members-dead'); // 사본 3개 = 하나의 그룹 (분리 금지)
  rg('many-members-no-split-dead'); // 동일 정규형 N멤버 → 통계적 분리 없이 한 그룹
  rg('exported-pair-dead'); // export 여부는 로직 중복 판정과 무관
  rg('trailing-return-dead'); // 말미 무조건 return; 유무만 다른 함수 (정규화)
  rg('delegation-plus-logic-dead'); // 위임+로직 1줄 = 골격 아님 → W (골격 경계 가드)

  // ════════════════════════════════════════════════════════════════════════
  // K — 정규형 어긋남 / 결정 없는 골격 / 비대상 → 보고 금지 (expected = [])
  // ════════════════════════════════════════════════════════════════════════

  rg('delegating-wrapper-keep'); // 골격: 파라미터 무변형 단일 호출 반환
  rg('void-delegation-keep'); // 골격: 파라미터 무변형 void 단일 호출 (`x => { f(x); }`)
  rg('projection-arrow-keep'); // 골격: 단일 필드 projection 화살표 (`u => u.isRead`) — 결정 없음
  rg('overload-signatures-keep'); // 비대상: overload 시그니처(TSDeclareFunction)는 수집 대상 아님
  rg('empty-marker-interface-keep'); // 골격: 빈 marker 타입
  rg('type-alias-synonym-keep'); // 골격: 명명 타입 bare 별칭(synonym) — 멤버 구조 없음
  rg('abstract-class-skeleton-keep'); // 골격: 멤버가 전부 abstract인 프로토콜 클래스
  rg('decorator-registration-keep'); // 골격: 프레임워크 등록 형태의 위임
  rgFrag('free-id-divergent-keep'); // 자유 식별자는 치환 불가 — 다른 호출 대상 = 다른 결정 (선언 레벨; 사소한 suffix는 floor)
  rg('single-literal-keep'); // 비대상: 단일 상수값 반복 (상수 추출 영역)
  rg('type-alias-diff-bodies-keep'); // 타입 선언 본문은 결정 그 자체 — 치환 금지
  rg('interface-member-order-keep'); // 멤버 순서 다름 = 정규형 어긋남
  rg('lookup-table-diff-content-keep'); // 규칙 데이터의 리터럴은 결정 그 자체 — 치환 금지

  // ════════════════════════════════════════════════════════════════════════
  // statement run — 함수 내부 연속 문장열 클론 (CLAUDE.md 닫힌 규칙)
  // ════════════════════════════════════════════════════════════════════════

  // W — 추출 가능한 연속 문장열 복제 (jscpd가 잡는 조각 + jscpd가 못 잡는 rename까지)
  rgFrag('stmt-run-extractable-dead'); // W: live-out ≤1, 추출 가능
  rgFrag('stmt-run-rename-dead'); // W: 지역변수명만 다른 문장열 (바인딩 정규화)
  rgFrag('stmt-run-trailing-return-dead'); // W: 마지막 top-level return은 추출 가능 (값 반환 헬퍼)
  rgFrag('near-miss-gapped-dead'); // W: 선언 near-miss는 미보고, 공유 문장열은 fragment 클론
  rgFrag('subfunction-fragment-dead'); // W: 서로 다른 함수가 공유하는 내부 문장열
  rgFrag('fragment-three-sites-dead'); // W: 같은 run이 3곳 → 하나의 그룹(items 3)

  // K — 조각 경계/안전성 가드 (minSize 12에서 실제 검증)
  rgFrag('stmt-run-nested-block-dead'); // W: if/for 등 중첩 블록 안의 공유 문장열도 대상
  rgFrag('stmt-run-leaks-binding-keep'); // K: live-out 2개 → 추출 불가
  rgFrag('stmt-run-too-small-keep'); // K: 최소 크기 미만 사소한 문장열
  rgFrag('stmt-run-single-statement-keep'); // K: 공유가 단일 문장뿐 — run(문장 덩어리 ≥2)이 아님
  rgFrag('stmt-run-free-id-keep'); // K: 다른 함수 호출 = 다른 결정 (run 끊김)
  rgFrag('stmt-run-yield-keep'); // K: yield 포함 run은 추출 불가 (generator 프로토콜)

  // ════════════════════════════════════════════════════════════════════════
  // 계약·데이터 — cross-kind 구조 비교 + 규칙 데이터 중복
  // ════════════════════════════════════════════════════════════════════════

  rg('interface-vs-typealias-dead'); // W: 같은 계약이 interface와 type alias 양쪽에 (cross-kind)
  rg('contract-method-sig-dead'); // W: 메서드 시그니처 계약 cross-kind
  rg('contract-index-sig-dead'); // W: index signature 계약 cross-kind
  rg('contract-optional-mismatch-keep'); // K: optional(?)은 계약의 일부 — id? vs id는 다른 계약
  rg('type-alias-generic-arg-diff-keep'); // K: 타입인자가 다르면 다른 계약 (본문 타입인자 치환 금지)
  rg('union-literals-differ-keep'); // K: union 리터럴이 다르면 다른 결정 (본문 리터럴 치환 금지)
  rg('discriminant-interface-keep'); // K: 판별 리터럴(kind)이 다르면 다른 계약 (멤버 리터럴 치환 금지)
  rg('lookup-table-dead'); // W: 동일 규칙 테이블이 다른 이름으로 중복 (데이터 선언)
  rg('lookup-array-table-dead'); // W: 배열 룩업 테이블 중복 (ArrayExpression 경로)
  rg('lookup-template-table-dead'); // W: 보간 없는 template literal 값 테이블
  rg('enum-dup-dead'); // W: 같은 멤버 enum이 다른 이름으로 중복 (값 보존)
  rg('enum-diff-values-keep'); // K: enum 값이 다르면 다른 결정
  rg('union-alias-dead'); // W: 동일 union 타입 별칭

  // ════════════════════════════════════════════════════════════════════════
  // 중첩 subsumption — 통째 클론 안의 fragment는 별도 보고하지 않는다
  // ════════════════════════════════════════════════════════════════════════

  rgFrag('fragment-subsumed-dead'); // 선언 클론만 보고, 내부 fragment는 subsume
});
