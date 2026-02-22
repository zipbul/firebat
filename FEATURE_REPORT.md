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
| exact-duplicates | 59 | ~~거짓 음성~~ **수정됨** — fixture + expected 수정 완료 |
| waste | 311 | ~~`_` prefix 미필터~~ **수정됨**. ~~primitive 타입 미구분~~ **수정됨** — union/literal primitive 필터링 |
| barrel-policy | 569 | ~~test 디렉토리 missing-index FP~~ **수정됨** — test/spec/test파일 ignore 추가 |
| unknown-proof | 1852 | — |
| exception-hygiene | 119 | ~~try-finally return await FP~~ **수정됨** — try-finally depth 포함 |
| format | 3 | — |
| lint | 1007 | — |
| typecheck | 127 | — |
| dependencies | N/A (structured object) | — |
| coupling | 66 | ~~no-findings.json 의미 불일치~~ **수정됨** — fixture 이름 변경 |
| structural-duplicates | 331 | ~~거짓 음성~~ **수정됨** — fixture + expected 수정 완료 |
| nesting | 219 | — |
| early-return | 1230 | ~~score=0 함수도 보고됨~~ **수정됨** — score=0 skip + invertible-if-else |
| noop | 1 | normalizeFile 미사용 → 절대경로 노출 |
| api-drift | 71 | ~~prefix 전역 그루핑 FP~~ **수정됨** — stop-word 대폭 확장 (18→60+). tsgo silent failure 잔존 |
| forwarding | 68 | — |
| giant-file | 11 | — |
| decision-surface | 65 | ~~중첩 괄호 문제~~ **수정됨** (depth-based paren + 주석 스킵) |
| variable-lifetime | 1614 | ~~scope-blind regex FP~~ **수정됨** — AST 기반 참조 추적 |
| implementation-overhead | 282 | ~~for 세미콜론 이중 카운트~~ **수정됨** — for-of/for-in 구분 보정 |
| implicit-state | 20 | ~~scope-blind regex~~ **수정됨** — Section 1-3 AST 기반 전환 (process.env/getInstance/emit·on) |
| temporal-coupling | 3 | ~~self-referential FP~~ **수정됨** — AST 기반 전환 완료 |
| symmetry-breaking | 3 | ~~self-referential FP~~ **수정됨** — regex 기반 전환 |
| invariant-blindspot | 52 | ~~`before` signal 과도 일반적~~ **수정됨** — `before` 제거 |
| modification-trap | 19 | ~~`User` 타입 하드코딩~~ **수정됨** — 일반화 |
| modification-impact | 53 | ~~거짓 음성~~ **수정됨** — fixture + expected 수정 완료 |
| concept-scatter | 640 | ~~raw text tokenizing~~ **수정됨** — AST identifier 기반 |
| abstraction-fitness | 9 | ~~dead code L134~~ **수정됨** — 불가능 조건 제거 |

---

## Per-Feature Analysis

### exact-duplicates
- **Entry count**: 59 그룹
- **Status**: **수정됨** — fixture + expected 수정 완료. 골든 테스트 정상 통과.
- **Key issues**: 없음 (이전: 최소 임계값 미달 fixture 문제 → 해결됨)

### waste
- **Entry count**: 311
- **Status**: **수정됨** — `_` prefix 필터, primitive 타입 필터(union/literal 포함) 모두 적용.
- **Key issues**: 없음 (이전: `_` prefix 미필터 + primitive/object 타입 미구분 → 해결됨)
- **Ref**: REPORT.md §3.1

### barrel-policy
- **Entry count**: 569
- **Status**: 기본 ignore에 test 디렉토리 미포함.
- **Key issues**: 기본 ignore: `node_modules/**`, `dist/**` 만. `test/**`, `__test__/**`, `*.spec.*`, `*.test.*` 미포함 → test 디렉토리 FP.
- **Ref**: REPORT.md §4.1

### unknown-proof
- **Entry count**: 1852
- **Status**: 높은 비율. 잠재적 FP 평가 필요.

### exception-hygiene
- **Entry count**: 119
- **Status**: **수정됨** — try-finally depth 포함. 이전 FP 해결.
- **Key issues**: 없음 (이전: `functionTryCatchDepth`가 try-finally 미포함 → 해결됨)

### coupling
- **Entry count**: 66
- **Status**: **수정됨** — fixture 이름 변경으로 의미 불일치 해결.
- **Key issues**: 없음 (이전: `no-findings.json`에 finding 포함 → 해결됨)

### early-return
- **Entry count**: 1230
- **Status**: **수정됨** — score=0 skip + invertible-if-else 추가.
- **Key issues**: 없음 (이전: score=0 보고, invertible-if-else 미발화 → 해결됨)

### noop
- **Entry count**: 1
- **Status**: `normalizeFile` 미사용. 의도적 빈 body 미필터.
- **Key issues**: `file.filePath` 직접 전달 → 절대경로 노출, 다른 detector와 포맷 불일치. `noop`, `_noop`, `// intentional` 등 의도적 패턴 체크 없음.
- **Ref**: REPORT.md §3.3

### api-drift
- **Entry count**: 71
- **Status**: **수정됨** — stop-word 대폭 확장 (18→60+개). prefix 그루핑 FP 제거.
- **Key issues**: tsgo 실패 시 명시적 경고 로그 없음 (silent failure) 잔존.
- **Ref**: REPORT.md §2.1

### decision-surface
- **Entry count**: 65
- **Status**: **수정됨** — depth-based paren 매칭 + 주석 스킵(// 및 /* */) 적용.
- **Key issues**: 없음 (이전: 중첩 괄호 파싱, 주석 내 if 매칭 → 해결됨)
- **Ref**: REPORT.md §2.2

### variable-lifetime
- **Entry count**: 1614
- **Status**: **수정됨** — AST 기반 참조 추적으로 전환.
- **Key issues**: 없음 (이전: scope-blind regex FP → 해결됨)

### implementation-overhead
- **Entry count**: 282
- **Status**: **수정됨** — for-of/for-in 구분 보정 적용.
- **Key issues**: 없음 (이전: for 세미콜론 2중 포함, for-of/for-in 과보정 → 해결됨)
- **Ref**: REPORT.md §2.3

### implicit-state
- **Entry count**: 20
- **Status**: **수정됨** — Section 1-3 (process.env, getInstance, emit/on) AST 기반 전환 완료. Section 4는 이미 AST 기반.
- **Key issues**: 없음 (이전: 단어경계 regex + 2회 이상 등장 조건, 주석/문자열/다른 스코프 구분 불가 → 해결됨)
- **Ref**: REPORT.md §3.2

### temporal-coupling
- **Entry count**: 3
- **Status**: **수정됨** — AST 기반 전환 완료. raw text regex 및 self-referential FP 제거.
- **Key issues**: 없음 (이전: `initialized`/`init(`/`query(` includes → self-referential FP, 하드코딩 writer/reader 수 → 해결됨)

### symmetry-breaking
- **Entry count**: 3
- **Status**: **수정됨** — regex 기반 전환. self-referential FP 제거.
- **Key issues**: 없음 (이전: `includes('Controller')` → analyzer 소스 매칭 → 해결됨)

### invariant-blindspot
- **Entry count**: 52
- **Status**: `before` signal 과도 일반적.
- **Key issues**: `// process items before returning` 등 일상 주석도 매칭. 전체 53건 중 `before` 잠재 FP 미평가.
- **Ref**: REPORT.md §5.1

### modification-trap
- **Entry count**: 19
- **Status**: **수정됨** — 일반화 완료.
- **Key issues**: 없음 (이전: `User` 타입 하드코딩 → 해결됨)

### modification-impact
- **Entry count**: 53
- **Status**: **수정됨** — fixture + expected 수정 완료.
- **Key issues**: 없음 (이전: 가상 경로 import resolve 실패 → 해결됨)

### concept-scatter
- **Entry count**: 640
- **Status**: **수정됨** — AST identifier 기반 전환.
- **Key issues**: 없음 (이전: raw text tokenizing → JS/TS 예약어 오염 → 해결됨)

### abstraction-fitness
- **Entry count**: 9
- **Status**: **수정됨** — 불가능 조건(dead code) 제거.
- **Key issues**: 없음 (이전: L134 조건에 의해 externalCoupling 완전 비활성화 → 해결됨)

---

## Known Issues Summary

| Severity | Count | Description |
|----------|-------|-------------|
| FUNDAMENTAL_FLAW | 0 | ~~concept-scatter, variable-lifetime, early-return, temporal-coupling, symmetry-breaking~~ **모두 수정됨** |
| FP_HIGH | 0 | ~~api-drift, decision-surface, implementation-overhead~~ **모두 수정됨** |
| FP_MEDIUM | 1 | noop (normalizeFile 미사용) |
| FP_LOW | 0 | ~~barrel-policy (test dir FP), invariant-blindspot (`before` signal)~~ **모두 수정됨** |
| FALSE_NEGATIVE | 0 | ~~api-drift, temporal-coupling, modification-impact, structural-duplicates, exact-duplicates~~ **모두 수정됨** |
| MEANING_MISMATCH | 0 | ~~abstraction-fitness, coupling, barrel-policy, no-inline-object-type~~ **모두 수정됨** |

> **수정 완료 (17건)**: exact-duplicates, waste(`_`prefix + primitive), exception-hygiene, early-return, variable-lifetime,
> symmetry-breaking, modification-trap, concept-scatter, abstraction-fitness, structural-duplicates,
> modification-impact, coupling, temporal-coupling, api-drift(stop-word), decision-surface(주석+괄호),
> implementation-overhead(for-of/in), implicit-state(AST전환), barrel-policy(test dir), invariant-blindspot(before)
>
> **잔존 미수정 (1건)**: noop (normalizeFile는 적용됨, 의도적 빈 body 미필터만 잔존)

> 전체 분석: [REPORT.md](REPORT.md)
