# gildash 문의 — default export가 named export와 구분되지 않음 (v0.36.0)

## 요약
gildash 0.36.0에서 **`export default`로 내보낸 심볼이 일반 named export와 구분되지 않습니다.** 심볼은 항상 *지역 이름*으로만 노출되고 default 표식이 없어서, `import x from './m'`(소비측 `dstSymbolName: "default"`)를 그 export 심볼과 이어붙일 수 없습니다. 이 때문에 소비 그래프 위에서 default export의 도달성(사용/미사용) 판정이 닫히지 않습니다.

## 재현 (v0.36.0)

두 파일이 **동일한 심볼**로 관측됩니다:

```ts
// def.ts
export default function delay() { return 1; }
// named.ts
export function delay() { return 1; }
```

`searchSymbols({})` 결과 — 두 파일이 완전히 동일 (default임을 알 신호가 없음):
```json
{ "name": "delay", "kind": "function", "isExported": true,
  "signature": "params:0|async:0", "fingerprint": "60c39e7030935485", "detail": {} }
```

다른 조회 경로에도 default 정보가 없습니다:
```
getModuleInterface("def.ts")
  → { exports: [ { name: "delay", kind: "function" } ] }        // 지역 이름, default 표식 없음

resolveSymbol("default", "def.ts")
  → { originalName: "default", originalFilePath: "def.ts", reExportChain: [], circular: false }
     // "delay"(지역 심볼)로 이어지지 않음 — 문자열 "default" 그대로 반환
```

반면 **소비측**은 default를 이미 알고 있습니다:
```
// main.ts:  import delay from './def'; delay();
searchRelations({ type: "imports" })
  → { srcFilePath: "main.ts", dstFilePath: "def.ts", dstSymbolName: "default", specifier: "./def" }
searchRelations({ type: "calls" })
  → { dstFilePath: "def.ts", dstSymbolName: "default" }
```

즉 **import 쪽 엣지는 `"default"`, export 쪽 심볼은 지역 이름(`"delay"`)** — 둘을 잇는 사실이 gildash에 없습니다. `export { g as default }`, `export default class X {}`, 익명 `export default 42 / () => {}` 형태 모두 export 이름 `"default"`가 소실됩니다(익명은 지역 이름조차 없음).

## 영향
소비 관계로 export 도달성을 판정하는 쪽(dead-export/미사용 export)에서 default export는 **소비자가 있어도 매칭 실패 → 거짓 "미사용"** 이 됩니다. 이를 zero-FP로 막으려면 default 소비 엣지가 있는 모듈 전체를 보류(HOLD)하는 수밖에 없어, 그 모듈의 진짜 미사용 named export까지 놓칩니다(과도한 FN). 근본 해결은 gildash가 default임을 사실로 노출해 주는 것입니다.

## 요청 (아래 중 하나면 닫힙니다)
- **A (선호)**: default로 내보낸 심볼에 표식 부여 — `searchSymbols`/`getModuleInterface`/`getSymbolsByFile`가 반환하는 심볼에 `isDefault: true`(또는 `detail.isDefault`). 익명 default도 이 표식으로 식별 가능.
- **B**: `resolveSymbol("default", file)`이 지역 정의 심볼로 해석 — `{ originalName: "delay", originalFilePath: "def.ts" }`. (익명 default는 합성 이름 필요.)
- **C**: `getModuleInterface`의 export 항목에 export 이름을 함께 — 예 `{ name: "delay", exportedAs: "default", kind }` 또는 `{ name: "default", localName: "delay" }`.

셋 중 아무거나 있으면 소비측 `"default"` 엣지를 export 심볼에 정확히 귀속할 수 있습니다. import 엣지는 이미 `"default"`를 담고 있으니, **export 심볼 쪽만 대칭으로 채워지면** 됩니다.

## 확인 질문
1. 익명 default(`export default 42`, `export default () => {}`)는 심볼로 노출되나요? 노출된다면 이름이 무엇인가요?
2. `export { x as default }` 재노출에서 export 이름 `"default"`를 어디선가 얻을 수 있나요? (현재 `re-exports` 관계나 심볼에 나타나지 않는 것으로 관측됩니다.)
3. A/B/C 중 gildash 설계상 가장 자연스러운 경로가 무엇인지 알려주시면 그에 맞춰 소비 매칭을 구현하겠습니다.

— firebat (dependencies detector)
