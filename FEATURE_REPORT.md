# FEATURE_REPORT.md — Feature Analyzer Findings Report

<!-- REPRODUCTION METADATA — update whenever this file is regenerated -->
```
[Reproduction Metadata]
Date       : 2026-02-18
Commit     : 81b15e8  (origin/main at scan time)
Engine     : oxc
Scan cmd   : bun dist/firebat.js --format json --log-level error
Target     : . (project root, recursive)
Target count: 300 files
Config     : .firebatrc (default detectors, default thresholds)
Output     : tmp/firebat-json-stdout.json  (5 MB, 2026-02-18 20:04)
Aggregation: entry count (one entry = one finding object in analyses[detector])
Note       : Counts reflect the analyzer output AS-IS, including known FP sources
             documented in REPORT.md. They are NOT ground-truth finding counts.
```

---

## Summary Table

| Detector | Entry count | Known issues (see REPORT.md) |
|----------|------------:|-------------------------------|
| exact-duplicates | 59 | 거짓 음성 (fixture 임계값 미달) |
| waste | 311 | `_` prefix 미필터, IIFE CFG 버그 |
| barrel-policy | 569 | test 디렉토리 missing-index FP |
| unknown-proof | 1852 | — |
| exception-hygiene | 119 | try-finally return await FP |
| format | 3 | — |
| lint | 1007 | — |
| typecheck | 127 | — |
| dependencies | N/A (structured object) | — |
| coupling | 66 | no-findings.json 의미 불일치 |
| structural-duplicates | 331 | 거짓 음성 (fixture 임계값 미달) |
| nesting | 219 | — |
| early-return | 1230 | score=0 함수도 보고됨 |
| noop | 1 | normalizeFile 미사용 → 절대경로 노출 |
| api-drift | 71 | prefix 전역 그루핑 FP, tsgo silent failure |
| forwarding | 68 | — |
| giant-file | 11 | — |
| decision-surface | 65 | maxAxes=2 과소, 중첩 괄호 문제 |
| variable-lifetime | 1614 | scope-blind regex FP |
| implementation-overhead | 282 | for 세미콜론 이중 카운트 |
| implicit-state | 20 | includes(name) 항상 true |
| temporal-coupling | 3 | self-referential FP (하드코딩 includes) |
| symmetry-breaking | 3 | self-referential FP (3건 전부 FP) |
| invariant-blindspot | 52 | `before` signal 과도 일반적 |
| modification-trap | 19 | `User` 타입 하드코딩 |
| modification-impact | 53 | 거짓 음성 (가상 경로 import resolve 실패) |
| concept-scatter | 640 | raw text tokenizing → 예약어 오염 |
| abstraction-fitness | 9 | dead code L134 → externalCoupling 비활성 |

---

## Per-Feature Analysis

### exact-duplicates
- **Entry count**: 59 그룹
- **Status**: 기능 동작 확인됨. 최소 임계값 미달 fixture 때문에 골든 테스트에서 거짓 음성.
- **Key issues**: `identical-loops.ts` / `similar-math.ts` expected가 `[]` — minSize 임계값 미달.
- **Ref**: REPORT.md §7.1

### waste
- **Entry count**: 311
- **Status**: 기능 동작하지만 FP 존재.
- **Key issues**: `_` prefix 변수 미필터, IIFE 내부 변수 CFG 버그, primitive/object 타입 미구분.
- **Ref**: REPORT.md §3.1

### barrel-policy
- **Entry count**: 569
- **Status**: 의미 불일치 있음.
- **Key issues**: `no-findings.json`에 `missing-index` 1건 포함 — index.ts 없으면 항상 보고.
- **Ref**: REPORT.md §8

### unknown-proof
- **Entry count**: 1852
- **Status**: 높은 비율. 잠재적 FP 평가 필요.

### exception-hygiene
- **Entry count**: 119
- **Status**: try-finally 패턴에서 FP 발생.
- **Key issues**: `functionTryCatchDepth`가 try-finally 미포함 → `return await` 불필요로 오판.
- **Ref**: REPORT.md §3.2

### coupling
- **Entry count**: 66
- **Status**: 의미 불일치 있음.
- **Key issues**: `no-findings.json`에 `COUPLING_OFF_MAIN_SEQ` 1건 포함.
- **Ref**: REPORT.md §8

### early-return
- **Entry count**: 1230
- **Status**: score=0인 함수도 보고됨, invertible-if-else 실제 발화 0건.
- **Key issues**: skip 조건에 `score===0` 체크 누락. guard 있고 return 0이어도 보고.
- **Ref**: REPORT.md §1.3

### noop
- **Entry count**: 1
- **Status**: `normalizeFile` 미사용.
- **Key issues**: `file.filePath`가 절대경로로 finding의 `file` 필드에 전달됨.
- **Ref**: REPORT.md §3.5

### api-drift
- **Entry count**: 71
- **Status**: FP 높음.
- **Key issues**: camelCase prefix 기반 그루핑 → 무관한 함수 묶임. tsgo silent failure. 거짓 음성 (`async-drift.ts` expected `[]`).
- **Ref**: REPORT.md §2.1, §7.1

### decision-surface
- **Entry count**: 65
- **Status**: FP 존재, `maxAxes=2` 과소.
- **Key issues**: 중첩 괄호 파싱 문제 (`if (fn(x))` → 조건 잘림). 함수 단위 분석 불가.
- **Ref**: REPORT.md §2.2

### variable-lifetime
- **Entry count**: 1614
- **Status**: scope-blind regex → FP 높음.
- **Key issues**: `new RegExp(name, 'g')` 파일 전체 검색. export 문을 last use로 카운트.
- **Ref**: REPORT.md §1.2

### implementation-overhead
- **Entry count**: 282
- **Status**: for 세미콜론 이중 카운트.
- **Key issues**: `semicolons + ifs + fors` 집계에서 for 헤더 세미콜론 2중 포함.
- **Ref**: REPORT.md §2.3

### implicit-state
- **Entry count**: 20
- **Status**: 패턴 4 `includes(name)` 항상 true → 무의미한 조건.
- **Key issues**: 변수 선언이 sourceText에서 추출되었으므로 해당 조건은 항등.
- **Ref**: REPORT.md §3.3

### temporal-coupling
- **Entry count**: 3
- **Status**: self-referential FP — 3건 전부 FP 추정.
- **Key issues**: `includes('initialized') && includes('init(') && includes('query(')` → analyzer 소스 자체에 매칭.
- **Ref**: REPORT.md §1.4

### symmetry-breaking
- **Entry count**: 3
- **Status**: self-referential FP — 3건 전부 FP 확정.
- **Key issues**: `includes('Controller')` → analyzer L53 regex에 'Controller' 포함.
- **Ref**: REPORT.md §1.5

### invariant-blindspot
- **Entry count**: 52
- **Status**: `before` signal 과도 일반적.
- **Key issues**: `// process items before returning` 등 일상 주석도 매칭.
- **Ref**: REPORT.md §5.1

### modification-trap
- **Entry count**: 19
- **Status**: `User` 타입 하드코딩 — 범용성 부재.
- **Key issues**: `import type { User }` 만 감지. `Order`, `Config` 등 무시.
- **Ref**: REPORT.md §4.1

### modification-impact
- **Entry count**: 53
- **Status**: 거짓 음성 확정 (high-impact fixture expected `[]`).
- **Key issues**: 가상 경로 import resolve 실패.
- **Ref**: REPORT.md §7.1

### concept-scatter
- **Entry count**: 640
- **Status**: ~90% FP 추정. raw text tokenizing.
- **Key issues**: JS/TS 예약어(`import`, `const`, `return`)가 concept 등록. `normalizeFile` 절대경로.
- **Ref**: REPORT.md §1.1

### abstraction-fitness
- **Entry count**: 9
- **Status**: `externalCoupling` 완전 비활성화. `no-findings.json` 의미 불일치.
- **Key issues**: L134 dead code 조건 → cross-layer 커플링 탐지 0건.
- **Ref**: REPORT.md §3.4, §8

---

## Known Issues Summary

| Severity | Count | Description |
|----------|-------|-------------|
| FUNDAMENTAL_FLAW | 5 | concept-scatter, variable-lifetime, early-return, temporal-coupling, symmetry-breaking |
| FP_HIGH | 3 | api-drift, decision-surface, implementation-overhead |
| FP_MEDIUM | 5 | waste, exception-hygiene, implicit-state, abstraction-fitness, noop |
| FP_LOW | 2 | modification-trap, barrel-policy |
| FALSE_NEGATIVE | 5 | api-drift, temporal-coupling, modification-impact, structural-duplicates, exact-duplicates |
| MEANING_MISMATCH | 4 | abstraction-fitness, coupling, barrel-policy, no-inline-object-type |

> 전체 분석: [REPORT.md](REPORT.md)
