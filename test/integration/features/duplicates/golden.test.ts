import { describe, it } from 'bun:test';

import { analyzeDuplicates } from '../../../../src/test-api';
import { runGolden } from '../../shared/golden-runner';

describe('golden/duplicates', () => {
  // minSize 1: 크기 임계로 케이스가 공허하게 통과(vacuous pass)하는 것을 차단하고
  // 모든 판정이 개념 규칙(정규형·골격·비대상)에서만 나오도록 고정한다.
  const rg = (name: string) => runGolden(import.meta.dir, name, program => analyzeDuplicates(program, { minSize: 1 }));

  // ════════════════════════════════════════════════════════════════════════
  // W — 결정을 담은 구문 + 정규형 일치 → 보고해야 한다 (CLAUDE.md 판정 절차)
  // ════════════════════════════════════════════════════════════════════════

  rg('exact-identical-fn-dead'); // Type-1: 동일 함수
  rg('rename-bound-vars-dead'); // 바인딩(파라미터·지역) 치환 → 정규형 일치
  rg('literal-variant-dead'); // 리터럴 치환 → 정규형 일치
  rg('type-variant-dead'); // 타입 주석 치환 → 정규형 일치
  rg('type-param-rename-dead'); // 타입파라미터 치환 → 정규형 일치
  rg('mixed-id-literal-dead'); // 바인딩+리터럴 동시 치환 합성도 W
  rg('identical-class-dead'); // 동일 클래스 → 단일 그룹 (메서드 subsume)
  rg('method-across-classes-dead'); // 클래스는 달라도 메서드 단위 중복은 W
  rg('arrow-fn-dead'); // arrow function도 선언 단위 대상
  rg('same-file-dead'); // "두 곳 이상"은 같은 파일 안도 포함
  rg('three-members-dead'); // 사본 3개 = 하나의 그룹 (분리 금지)
  rg('exported-pair-dead'); // export 여부는 로직 중복 판정과 무관
  rg('delegation-plus-logic-dead'); // 위임+로직 1줄 = 골격 아님 → W (골격 경계 가드)

  // ════════════════════════════════════════════════════════════════════════
  // K — 정규형 어긋남 / 결정 없는 골격 / 비대상 → 보고 금지 (expected = [])
  // ════════════════════════════════════════════════════════════════════════

  rg('delegating-wrapper-keep'); // 골격: 파라미터 무변형 단일 호출 반환
  rg('overload-signatures-keep'); // 골격: 본문 없는 overload 시그니처
  rg('empty-marker-interface-keep'); // 골격: 빈 marker 타입
  rg('decorator-registration-keep'); // 골격: 프레임워크 등록 형태의 위임
  rg('near-miss-gapped-keep'); // 비대상: 문장 삽입으로 정규형 어긋남 (Type-3)
  rg('free-id-divergent-keep'); // 자유 식별자는 치환 불가 — 다른 호출 대상 = 다른 결정
  rg('subfunction-fragment-keep'); // 비대상: 함수 내부 일부 구문열 (선언 단위 밖)
  rg('single-literal-keep'); // 비대상: 단일 상수값 반복 (상수 추출 영역)
  rg('type-alias-diff-bodies-keep'); // 타입 선언 본문은 결정 그 자체 — 치환 금지
  rg('interface-member-order-keep'); // 멤버 순서 다름 = 정규형 어긋남
  rg('lookup-table-diff-content-keep'); // 규칙 데이터의 리터럴은 결정 그 자체 — 치환 금지

  // ════════════════════════════════════════════════════════════════════════
  // statement run — 함수 내부 연속 문장열 클론 (CLAUDE.md 닫힌 규칙)
  // ════════════════════════════════════════════════════════════════════════

  // W — 조각 탐지 미구현. 구현 후 it.todo → rg 전환하며 골든 락.
  it.todo('golden: stmt-run-extractable-dead — 추출 가능한 연속 문장열 복제', () => {});
  it.todo('golden: stmt-run-rename-dead — 지역변수명만 다른 문장열 (jscpd는 못 잡음)', () => {});

  // K — 조각 경계/안전성 가드. 조각 탐지 구현 후 over-report 방지를 검증 (지금은 vacuous green).
  rg('stmt-run-leaks-binding-keep'); // K: 조각 내 선언을 밖에서 사용 → 추출 불가
  rg('stmt-run-too-small-keep'); // K: 최소 크기 미만 사소한 문장열
  rg('stmt-run-free-id-keep'); // K: 다른 함수 호출 = 다른 결정

  // ════════════════════════════════════════════════════════════════════════
  // W — 미구현 영역 (구현 시 runGolden으로 전환)
  // ════════════════════════════════════════════════════════════════════════

  it.todo('golden: interface-vs-typealias-dead — 같은 계약이 interface와 type alias 양쪽에 (cross-kind 구조 비교 미구현)', () => {});

  it.todo('golden: lookup-table-dead — 동일 규칙 테이블 중복 (데이터 선언 대상 수집 미구현)', () => {});
});
