# FINAL.md — firebat 종합 감사 리포트

> 장점 없음. 문제점 · 부족한 점 · 보강 제안만 기재.

---

---

## 1-E: knip 비교

### 문제점

1. **knip 실행 불가**: `drizzle.config.ts`가 `import.meta.dir`(Bun 전용 API) 사용 → knip의 Node.js 기반 config loader가 crash. `Error loading drizzle.config.ts: The "paths[0]" argument must be of type string. Received undefined`.

2. **비교 불가**: knip dead exports 결과와 firebat dead exports(140건) 비교 불가 → firebat의 dead export 정확도 크로스 검증 못 함.

### 보강 제안

- knip.json에 `"ignore": ["drizzle.config.ts"]` 추가하여 knip 실행 가능하게.
- 또는 drizzle.config.ts에서 `import.meta.dir` 대신 `__dirname` 폴백 추가.

---

## 1-F: dependency-cruiser 비교

### 문제점

1. **depcruise 20건 violation vs firebat 4건 layer violation**: depcruise의 `not-to-test` rule이 src/*.spec.ts → test/ 의존성 20건을 잡지만, firebat는 4건 layer violation만 보고. depcruise가 17개 oxlint-plugin rule spec 파일의 test/ 유틸 임포트를 잡는 것 → firebat의 layer violation 감지가 이 패턴을 놓침.

2. **firebat cycle=0, depcruise cycle 미검사**: depcruise는 `.dependency-cruiser.cjs` 설정에 의존. 별도 cycle 리포트 없이 `not-to-test`만 나옴. firebat도 cycle=0. 교차 검증은 일치하나 두 도구 모두 cycle이 실제 없는 건지 확인 어려움.

---

## 2-A: feature별 정확도 평가

### 문제점

1. **early-return 1230건 과다**: 프로젝트 300파일 대비 1230건은 과잉. 모든 if+return 패턴을 잡는 것처럼 보임 — guard clause가 이미 있는 경우에도 보고하는지 검증 필요.

2. **barrel-policy 569건/285파일**: 거의 모든 파일에 barrel 위반. feature detector convention상 `index.ts` barrel이 의도적인데 이것까지 잡는 것이라면 config에서 exclude 옵션이 필요.

3. **unknown-proof 1852건**: 가장 많은 finding. type assertion이 모두 위험한 게 아닌데 (e.g., `as const`, well-typed assertion) 구분 없이 전부 보고.

### 부족한 점

- finding에 **confidence/severity** 레벨이 일부 감지기(waste, noop)에만 있고 대부분 없음.
- **actionable한 suggestion**이 finding 레벨에 없음 (catalog에 일반적 설명만). "이 코드를 이렇게 바꿔라" 수준의 구체적 제안 부재.

---

## 2-F: 외부 도구 내재화 판단

### knip

- **현재 사용 불가** (drizzle.config.ts crash). 내재화 불필요 — firebat의 `dependencies` 감지기가 dead exports 140건을 이미 감지.
- 다만 knip은 **unused files**, **unused dependencies** (package.json), **duplicate exports** 도 감지. firebat에서 unused dependencies 감지 추가 고려.

### dependency-cruiser

- depcruise의 20건 `not-to-test` violation 중 firebat의 layer violation(4건)과 부분 겹침.
- depcruise가 잡는 패턴(src/*.spec.ts → test/ 유틸 임포트)을 firebat이 못 잡는 것은 **firebat의 layer violation 규칙이 oxlint-plugin spec 파일을 인식하지 못하는 것** → layer boundary 설정 보강.
- 내재화보다는 firebat의 layer violation 규칙 개선이 적절.


---

## 종합 우선순위

| 우선순위 | 항목 | 영향도 |
|----------|------|--------|
| P2 | MCP 요약 모드 | LLM 컨텍스트 효율 |
| P3 | test 코드 경계 인식 | false positive 감소 |
