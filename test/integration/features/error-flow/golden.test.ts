import type { Gildash } from '@zipbul/gildash';

import { describe } from 'bun:test';

import { analyzeErrorFlow } from '../../../../src/test-api';
import { runGolden } from '../../shared/golden-runner';

const noopGildash = {
  isThenableAtSpan: () => null,
  getExpressionTypeAtSpan: () => null,
  getContextualCallReturnsAtSpan: () => null,
  isTypeAssignableToTypeAtSpan: () => null,
} as unknown as Gildash;

describe('golden/error-flow', () => {
  runGolden(import.meta.dir, 'no-findings', program => analyzeErrorFlow(program, { gildash: noopGildash }));

  runGolden(import.meta.dir, 'try-finally', program => analyzeErrorFlow(program, { gildash: noopGildash }));

  runGolden(import.meta.dir, 'throw-non-error', program => analyzeErrorFlow(program, { gildash: noopGildash }));

  runGolden(import.meta.dir, 'promise-patterns', program => analyzeErrorFlow(program, { gildash: noopGildash }));

  runGolden(import.meta.dir, 'nested-try-catch', program => analyzeErrorFlow(program, { gildash: noopGildash }));

  runGolden(import.meta.dir, 'unobserved-variable', program => analyzeErrorFlow(program, { gildash: noopGildash }));

  // ════════════════════════════════════════════════════════════════════════
  // 코퍼스 감사 + CLAUDE.md 개념 정의 정렬로 추가된 고정 케이스 (모두 구현 완료, GREEN).
  // ════════════════════════════════════════════════════════════════════════
  const rg = (name: string) => runGolden(import.meta.dir, name, program => analyzeErrorFlow(program, { gildash: noopGildash }));

  // ── Fix1 misused-promises: 결과 관찰되면 K (RED), forEach/filter/폐기는 W (가드) ──
  rg('misused-map-promise-all-keep');
  rg('misused-map-returned-keep');
  rg('misused-reduce-awaited-keep');
  rg('misused-flatmap-discarded-dead'); // flatMap is result-group: W when the result is discarded
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

  // ── missing-error-cause: cause-preserving throws never flag (incl. FP-A/FP-B regression guards) ──
  rg('missing-error-cause-keep');

  // ── unsafe-finally (block form): return/break in a finally masks the try; cleanup-only is K ──
  rg('unsafe-finally-return-dead');

  // ── floating-promises (syntactic factories): discarded import() and new Promise ──
  rg('floating-factory-dead');
  runGolden(import.meta.dir, 'promise-finally-return-keep', program => analyzeErrorFlow(program, { gildash: noopGildash }));
  runGolden(import.meta.dir, 'multi-then-chain-catch-keep', program => analyzeErrorFlow(program, { gildash: noopGildash }));
});
