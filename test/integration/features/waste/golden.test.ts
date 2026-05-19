import { describe } from 'bun:test';

import { detectWaste } from '../../../../src/test-api';
import { runGolden } from '../../shared/golden-runner';

describe('golden/waste', () => {
  // ── Positive: 6개 케이스 (case 5는 no-unused-vars 영역이라 제외) ──────
  // case 1: 할당 후 read 전에 덮임
  runGolden(import.meta.dir, 'overwrite-chain', program => detectWaste([...program]));
  // case 2: 모든 분기에서 덮는 초기값
  runGolden(import.meta.dir, 'all-branches-overwrite', program => detectWaste([...program]));
  // case 3: 같은 값 재할당
  runGolden(import.meta.dir, 'same-value-reassign', program => detectWaste([...program]));
  // case 4: try/catch 양쪽이 덮음
  runGolden(import.meta.dir, 'try-catch-overwrite', program => detectWaste([...program]));
  // case 6: 외부로 escape 안 하는 누적 변수
  runGolden(import.meta.dir, 'no-escape-accumulator', program => detectWaste([...program]));
  // case 7: 외부로 escape 안 하는 객체 변수
  runGolden(import.meta.dir, 'no-escape-object', program => detectWaste([...program]));

  // ── Positive: case 1 흐름 변형 ────────────────────────────────────────
  // switch fallthrough overwrite (case 1)
  runGolden(import.meta.dir, 'switch-fallthrough', program => detectWaste([...program]));
  // scope-exit dead write — 변수는 use≥1이지만 마지막 write가 read 없이 종료 (case 1)
  runGolden(import.meta.dir, 'finally-null-gc-hint', program => detectWaste([...program]));

  // ── Negative: boundary KEEP ───────────────────────────────────────────
  // closure가 변수를 read (case 1 반례)
  runGolden(import.meta.dir, 'closure-read', program => detectWaste([...program]));
  // return으로 escape (case 6·7 반례)
  runGolden(import.meta.dir, 'return-escape', program => detectWaste([...program]));
  // callback closure로 escape (case 6 반례)
  runGolden(import.meta.dir, 'callback-closure-escape', program => detectWaste([...program]));
  // mutation 전 snapshot — alias처럼 보여도 값이 다름 (case 1 반례)
  runGolden(import.meta.dir, 'snapshot-before-mutation', program => detectWaste([...program]));
  // using declaration — 자원 lifetime (CLAUDE.md K 명시)
  runGolden(import.meta.dir, 'using-resource', program => detectWaste([...program]));
  // 객체가 return으로 escape (case 7 반례)
  runGolden(import.meta.dir, 'dynamic-property-return', program => detectWaste([...program]));
  // JSON.stringify reflection + return escape (case 7 반례)
  runGolden(import.meta.dir, 'json-stringify-escape', program => detectWaste([...program]));
  // while-loop assignment idiom — binding-only declaration
  runGolden(import.meta.dir, 'regex-exec-iteration', program => detectWaste([...program]));
  // 분석 대상 외: class field (CLAUDE.md 비대상)
  runGolden(import.meta.dir, 'class-field-out-of-scope', program => detectWaste([...program]));
  // 분석 대상 외: export const module-scope (CLAUDE.md 비대상)
  runGolden(import.meta.dir, 'no-findings', program => detectWaste([...program]));
});
