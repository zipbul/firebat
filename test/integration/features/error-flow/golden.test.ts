import type { Gildash } from '@zipbul/gildash';

import { describe } from 'bun:test';

import { analyzeErrorFlow } from '../../../../src/test-api';
import { runGolden } from '../../shared/golden-runner';

const noopGildash = {
  isTypeAssignableToType: () => null,
  getResolvedTypesAtPositions: () => new Map(),
  isTypeAssignableToTypeAtPositions: () => new Map(),
} as unknown as Gildash;

describe('golden/error-flow', () => {
  runGolden(import.meta.dir, 'no-findings', program => analyzeErrorFlow(program, { gildash: noopGildash }));

  runGolden(import.meta.dir, 'try-finally', program => analyzeErrorFlow(program, { gildash: noopGildash }));

  runGolden(import.meta.dir, 'throw-non-error', program => analyzeErrorFlow(program, { gildash: noopGildash }));

  runGolden(import.meta.dir, 'promise-patterns', program => analyzeErrorFlow(program, { gildash: noopGildash }));

  runGolden(import.meta.dir, 'nested-try-catch', program => analyzeErrorFlow(program, { gildash: noopGildash }));

  runGolden(import.meta.dir, 'unobserved-variable', program => analyzeErrorFlow(program, { gildash: noopGildash }));

  // ════════════════════════════════════════════════════════════════════════
  // RED (구현 전): 코퍼스 감사 + 새 CLAUDE.md 기준 정렬. 구현 전이라 실패해야 정상.
  // ════════════════════════════════════════════════════════════════════════
  const rg = (name: string) => runGolden(import.meta.dir, name, program => analyzeErrorFlow(program, { gildash: noopGildash }));

  // ── Fix1 misused-promises: 결과 관찰되면 K (RED), forEach/filter/폐기는 W (가드) ──
  rg('misused-map-promise-all-keep');
  rg('misused-map-returned-keep');
  rg('misused-reduce-awaited-keep');
  rg('misused-flatmap-discarded-dead'); // FN: flatMap 편입 후 misused
  rg('misused-foreach-dead');
  rg('misused-map-discarded-dead');
  rg('misused-filter-async-dead');
  rg('misused-flatmap-returned-keep');

  // ── promise-ctor: async-executor / throw-after-settle = W; bare sync throw / delay / deferred = K ──
  rg('promise-ctor-delay-keep');
  rg('promise-ctor-deferred-keep');
  rg('promise-ctor-async-executor-dead');
  rg('promise-ctor-sync-throw-keep');
  rg('promise-ctor-throw-after-settle-dead');

  // ── Fix3 비대상 스타일·redundancy 비보고 (RED), prefer-catch 유지 (가드) ──
  rg('style-no-return-wrap-keep');
  rg('style-prefer-await-keep');
  rg('redundant-useless-catch-keep');
  rg('always-return-terminal-keep');
  rg('style-prefer-catch-keep');

  // ── Fix4 empty-catch 신규 (RED, FN), 주석 있으면 K (가드) ──
  rg('empty-catch-dead');
  rg('empty-catch-binding-dead');
  rg('empty-catch-whitespace-dead');
  rg('empty-catch-commented-dead');
  rg('empty-catch-nonempty-keep');

  // ── throw-non-error: 증명 가능한 non-Error만 W (member/identifier는 benefit-of-doubt) ──
  rg('throw-member-error-keep');
  rg('throw-cast-string-dead');

  // ── Promise.reject(non-Error) = throw-non-error (empty rejection handler is gildash-gated → spec-tested) ──
  rg('reject-non-error-dead');
  rg('reject-error-keep');
});
