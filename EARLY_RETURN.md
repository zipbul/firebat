# Early Return: implicit-else 패턴 구현

## 현황

현재 3개 패턴 감지 완료:

- `wrapping-if` — 블록 마지막 if(no else)가 전체를 감쌈
- `invertible-if-else` — if-else에서 짧은 쪽이 exit, 긴 쪽의 else 제거 가능
- `cascade-guard` — else-if chain의 모든 non-final branch가 exit

## 미감지 패턴: implicit-else

if-block(no else)이 exit(return/throw/continue)으로 끝나고, 뒤에 짧은 코드가 따르는 패턴.
`invertible-if-else`의 암시적 형태이며, 현재 어떤 detector도 탐지하지 못한다.

### 함수 body

```typescript
// BEFORE — 미탐지
function process(data) {
  if (data.isValid) {
    doA();
    doB();
    doC();
    doD();
    doE();
    return result;
  }
  return null; // implicit else (1 stmt)
}

// AFTER — 중첩 1레벨 감소, 6개 statement 탈출
function process(data) {
  if (!data.isValid) return null;
  doA(); doB(); doC(); doD(); doE();
  return result;
}
```

### 루프 body

```typescript
// BEFORE — 미탐지
for (const item of items) {
  if (item.isSpecial) {
    processA(item);
    processB(item);
    processC(item);
    continue;
  }
  handleDefault(item); // implicit else
}

// AFTER
for (const item of items) {
  if (!item.isSpecial) { handleDefault(item); continue; }
  processA(item);
  processB(item);
  processC(item);
}
```

### 미탐지 원인

- `wrapping-if`: 마지막 statement가 IfStatement가 아님 (return/continue가 마지막)
- `invertible-if-else`: alternate(else)가 없어 진입 자체 안 됨
- `cascade-guard`: alternate가 없어 패스

### 감지 조건 (초안)

```
detectImplicitElse(bodyStatements, insideLoop, sourceText):
  if len(bodyStatements) < 2: return null

  // body 순회: if(no else) + exit으로 끝나는 consequent를 찾음
  for i in 0..len-1:
    stmt = bodyStatements[i]
    if stmt.type != 'IfStatement': continue
    if stmt.alternate != null: continue
    if !isExitBlock(stmt.consequent): continue  // consequent가 exit으로 끝나야 함

    // 뒤따르는 statements를 "implicit else"로 취급
    remainingCount = len(bodyStatements) - i - 1
    consequentCount = countStatements(stmt.consequent)

    // invertible-if-else와 동일한 비율 조건
    shortCount = min(remainingCount, consequentCount)
    longCount = max(remainingCount, consequentCount)
    if shortCount > 3: continue
    if longCount < shortCount * 2: continue

    // 짧은 쪽이 exit으로 끝나야 함
    // remaining이 짧은 쪽이면: remaining의 마지막이 exit인지 확인
    // consequent가 짧은 쪽이면: 이미 isExitBlock으로 확인됨

    return Opportunity(kind: 'implicit-else', depthReduction: 1, statementsAffected: longCount)

  return null
```

### kind 이름

기존 kind에 추가: `'implicit-else'`

또는 `invertible-if-else`에 통합하여 새 kind 없이 구현 가능 (설계 판단 필요).

### 영향 범위

| 파일 | 변경 |
|------|------|
| `src/types.ts` | `EarlyReturnKind`에 `'implicit-else'` 추가 (또는 통합 시 불변) |
| `src/features/early-return/analyzer.ts` | `detectImplicitElse` 함수 추가, `visit`의 BlockStatement 분기에서 호출 |
| `src/features/early-return/analyzer.spec.ts` | implicit-else 시나리오 테스트 추가 |
| `src/application/scan/diagnostic-aggregator.ts` | catalog 항목 추가 (새 kind인 경우) |
| `src/application/scan/scan.usecase.ts` | kindToCode 매핑 추가 (새 kind인 경우) |
| `test/integration/features/early-return/` | fixture + expected 추가 |

### 비고

- ESLint `no-else-return`이 주로 다루는 핵심 패턴
- explicit else가 없는 코드일수록 발생 빈도가 높음 (좋은 개발자일수록 else 생략)
- 이 패턴 구현 후, 현실적으로 탐지 가능한 early-return 패턴은 모두 커버됨
