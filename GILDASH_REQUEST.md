# gildash API 요청 (응답 반영)

## 1. 내부 구현 public 노출 (구현 완료, 위임만)

### position 기반 semantic API

line/column 기반만 있고 byte offset 기반이 없다. oxc-parser, ast-grep 등 AST 도구는 전부 byte offset이다. 내부 SemanticLayer에 position 기반 구현이 이미 있으므로 위임만 하면 된다.

```typescript
getResolvedTypeAtPosition(filePath: string, position: number): ResolvedType | null;
getSemanticReferencesAtPosition(filePath: string, position: number): SemanticReference[];
getImplementationsAtPosition(filePath: string, position: number): Implementation[];
isTypeAssignableToAtPosition(srcFilePath: string, srcPosition: number, dstFilePath: string, dstPosition: number): boolean | null;
```

### 내부 유틸 노출

```typescript
// tsc SourceFile 기반 변환. 내부 SemanticLayer에 구현 존재.
lineColumnToPosition(filePath: string, line: number, column: number): number | null;

// declaration position에서 실제 이름 identifier position 찾기. 내부 구현 존재.
findNamePosition(filePath: string, position: number): number | null;

// tsc 심볼 그래프 노드 접근. 내부 구현 존재.
getSymbolNode(filePath: string, position: number): SymbolNode | null;
```

## 2. 타입 선언 수정 (코드 변경 없음)

### relation 반환 타입

실제로 `StoredCodeRelation`을 반환하는데 선언이 `CodeRelation[]`. `StoredCodeRelation extends CodeRelation`이므로 breaking 아님.

```typescript
searchRelations(query: RelationSearchQuery): StoredCodeRelation[];
searchAllRelations(query: RelationSearchQuery): StoredCodeRelation[];
getInternalRelations(filePath: string, project?: string): StoredCodeRelation[];
```

## 3. DependencyGraph 파사드 누락 메서드

`DependencyGraph` 클래스가 직접 export되지만, `Gildash` 파사드에 없는 메서드가 있다. 파사드에서 접근 가능하면 `DependencyGraph` 직접 사용이 불필요해진다.

```typescript
// 역방향 transitive — 특정 파일에 transitively 의존하는 모든 파일. getAffected의 단일 파일 버전.
getTransitiveDependents(filePath: string, project?: string): Promise<string[]>;
```

## 4. 신규 기능

### Call Graph

import 그래프(`DependencyGraph`)는 있는데 함수 호출 그래프가 없다. `searchRelations({ type: 'calls' })`로 raw 데이터는 있으므로 `DependencyGraph`와 동일 패턴으로 구축 가능.

```typescript
// import graph의 함수 호출 버전
getCallGraph(project?: string): Promise<CallGraph>;

// 특정 함수의 callers/callees
getCallers(symbolName: string, filePath: string, project?: string): Array<{ symbolName: string; filePath: string }>;
getCallees(symbolName: string, filePath: string, project?: string): Array<{ symbolName: string; filePath: string }>;
```

활용: temporal-coupling(함수 호출 순서 제약), error-flow(에러 전파 경로), indirection(wrapper chain 추적).

### Symbol Usage 통계

`getSemanticReferences`는 있지만 집계가 없다. 매번 전체 참조를 가져와서 세는 건 비효율.

```typescript
// 심볼의 참조 횟수 (read/write 구분)
getSymbolUsageCount(symbolName: string, filePath: string, project?: string): {
  totalReferences: number;
  readCount: number;
  writeCount: number;
  fileCount: number;  // 참조하는 파일 수
};
```

활용: dead code 정밀 탐지, god-symbol 감지, 리팩토링 영향도 분석.

### Module Metrics

fan-in/fan-out은 있지만 파생 메트릭이 없다. coupling 분석기가 직접 계산하고 있다.

```typescript
getModuleMetrics(filePath: string, project?: string): Promise<{
  fanIn: number;
  fanOut: number;
  instability: number;        // fanOut / (fanIn + fanOut)
  abstractness: number;       // abstract/interface 비율
  distanceFromMainSequence: number;  // |abstractness + instability - 1|
}>;
```

활용: coupling 디텍터가 자체 계산 대신 gildash에 위임. off-main-sequence, unstable-module, rigid-module 탐지 단순화.

### Heritage Depth

`getHeritageChain`은 트리를 반환하지만 깊이를 직접 제공하지 않는다.

```typescript
getHeritageDepth(symbolName: string, filePath: string, project?: string): Promise<number>;
```

활용: deep-inheritance 탐지 (depth > N).

### tsc Diagnostics 노출

gildash가 `semantic: true`로 tsc Program을 이미 로드하고 있다. 그런데 tsc diagnostics(타입 에러, 경고)를 노출하지 않아서 firebat의 typecheck 디텍터가 `ts.createProgram()`을 **별도로 생성**하고 있다. tsc Program 이중 생성은 메모리/시간 낭비.

```typescript
// 파일별 tsc diagnostics
getDiagnostics(filePath: string): Array<{
  filePath: string;
  line: number;
  column: number;
  message: string;
  code: number;
  category: 'error' | 'warning' | 'suggestion';
}>;

// 전체 프로젝트 diagnostics
getAllDiagnostics(): Array</* 위와 동일 */>;
```

활용: firebat typecheck 디텍터가 자체 tsc Program 생성 제거. gildash의 semantic layer가 이미 보유한 tsc Program 재사용.

### Batch Query

여러 심볼의 타입을 한 번에 조회. 파일별로 `getFileTypes`가 있지만 cross-file 배치가 없다.

```typescript
batchGetResolvedType(queries: Array<{ symbolName: string; filePath: string }>): Array<ResolvedType | null>;
```

활용: 대규모 프로젝트에서 N+1 쿼리 방지.

---

## 응답 결과

### 승인 (다음 마이너 포함 예정)

- position 기반 semantic API 4개
- `lineColumnToPosition`, `getSymbolNode` public 노출
- `searchRelations` / `searchAllRelations` / `getInternalRelations` 반환 타입 `StoredCodeRelation[]` 수정
- `getTransitiveDependents` 파사드 추가

### 거절

- **`findNamePosition`**: 3파라미터 시그니처로 재요청 → **승인. 다음 마이너 포함.**
- **Call Graph, Symbol Usage, Module Metrics, Heritage Depth, Batch Query**: 기존 API 조합으로 소비자 측에서 구현 가능. 편의 래퍼를 엔진에 넣지 않는 방침.
- **tsc Diagnostics**: 파일 단위 `getSemanticDiagnostics(filePath)` → **승인. 다음 마이너 포함.** `getAllDiagnostics`는 제외.

---

## 후속 논의

### `findNamePosition` 재요청

시그니처를 내부와 동일하게 3파라미터로 수정합니다.

```typescript
findNamePosition(filePath: string, declarationPos: number, name: string): number | null;
```

용도: `searchSymbols`로 얻은 심볼의 `span.start`(선언 위치)에서 실제 identifier의 byte offset을 찾을 때. position 기반 API에 정확한 identifier position을 전달하기 위해 필요.

### tsc Diagnostics 설계 논의

firebat 관점에서 필요한 것:
- `tsc --noEmit` 수준의 전체 타입 검사가 아님
- **인덱싱된 파일 범위 내에서의 semantic diagnostics만으로 충분**
- firebat의 typecheck 디텍터가 현재 자체 `ts.createProgram()`으로 하는 것: semantic diagnostics(타입 에러) 수집
- 동일 파일 범위에서 gildash의 Program이 이미 diagnostics를 생성할 수 있다면 이중 Program 생성 제거 가능

결과: **승인.**
- LanguageServiceHost가 인덱싱 파일은 tracked content, 외부(node_modules, lib)는 resolveNonTrackedFile로 해석 → 인덱싱 범위 내 유효한 diagnostics 생성 확인
- 인덱싱되지 않은 파일 호출 시 빈 배열 반환
- 파일 단위 `getSemanticDiagnostics(filePath): SemanticDiagnostic[]`만 제공, `getAllDiagnostics`는 제외
