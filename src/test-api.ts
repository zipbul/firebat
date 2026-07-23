/**
 * Public API surface for integration / e2e tests.
 *
 * All test files under `test/integration/` and `test/e2e/` MUST import
 * through this barrel — never via internal `src/` paths directly.
 * This decouples tests from internal directory structure so that
 * refactoring phases can proceed without modifying test files.
 *
 * @module test-api
 */

// ---------------------------------------------------------------------------
// Features — analyze / detect  (Phase 2 에서 detectors/ 로 이동 예정)
// ---------------------------------------------------------------------------
export { analyzeBarrel } from './features/barrel';
export { analyzeDependencies } from './features/dependencies';
export { analyzeEarlyReturn } from './features/early-return';
export { analyzeErrorFlow } from './features/error-flow';
export { analyzeIndirection } from './features/indirection';
export { analyzeGiantFile } from './features/giant-file';
export { analyzeNesting } from './features/nesting';
export { analyzeTemporalCoupling } from './features/temporal-coupling';
export { analyzeVariableLifetime } from './features/variable-lifetime';
export { detectWaste } from './features/waste';
export { analyzeDuplicates } from './features/duplicates';

// ---------------------------------------------------------------------------
// Engine  (Phase 3 에서 서브디렉토리화 예정)
// ---------------------------------------------------------------------------
export { parseSource } from './engine/ast/parse-source';
export { PartialResultError } from './engine/partial-result-error';
export type { ParsedFile } from './engine/types';

// ---------------------------------------------------------------------------
// Types  (Phase 3 에서 shared/ 이동 가능)
// ---------------------------------------------------------------------------
export type { DuplicateGroup, WasteFinding, FirebatReport } from './types';

// ---------------------------------------------------------------------------
// Application — scan  (Phase 2 에서 pipeline 으로 전환 예정)
// ---------------------------------------------------------------------------
export { scanUseCase } from './application/scan/scan.usecase';
export { aggregateDiagnostics } from './application/scan/diagnostic-aggregator';

// ---------------------------------------------------------------------------
// Infrastructure  (Phase 0/3 에서 교체/이동 예정)
// ---------------------------------------------------------------------------
export { createPrettyConsoleLogger } from './shared/logger';

// ---------------------------------------------------------------------------
// Ports  (Phase 3 에서 shared/ 이동 예정)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Adapters — CLI  (Phase 4)
// ---------------------------------------------------------------------------
export { runInstall, runUpdate } from './adapters/cli/install';

// ---------------------------------------------------------------------------
// oxlint-plugin — Rules
// ---------------------------------------------------------------------------
export { blankLinesBetweenStatementGroupsRule } from './oxlint-plugin/rules/blank-lines-between-statement-groups';
export { memberOrderingRule } from './oxlint-plugin/rules/member-ordering';
export { noBracketNotationRule } from './oxlint-plugin/rules/no-bracket-notation';
export { noDynamicImportRule } from './oxlint-plugin/rules/no-dynamic-import';
export { noGlobalThisMutationRule } from './oxlint-plugin/rules/no-globalthis-mutation';
export { noInlineObjectTypeRule } from './oxlint-plugin/rules/no-inline-object-type';
export { noTombstoneRule } from './oxlint-plugin/rules/no-tombstone';
export { noUmbrellaTypesRule } from './oxlint-plugin/rules/no-umbrella-types';
export { noUnmodifiedLoopConditionRule } from './oxlint-plugin/rules/no-unmodified-loop-condition';
export { paddingLineBetweenStatementsRule } from './oxlint-plugin/rules/padding-line-between-statements';
export { singleExportedClassRule } from './oxlint-plugin/rules/single-exported-class';
export { testDescribeSutNameRule } from './oxlint-plugin/rules/test-describe-sut-name';
export { testUnitFileMappingRule } from './oxlint-plugin/rules/test-unit-file-mapping';
export { unusedImportsRule } from './oxlint-plugin/rules/unused-imports';

// ---------------------------------------------------------------------------
// oxlint-plugin — Types
// ---------------------------------------------------------------------------
export type {
  AstNode,
  AstNodeValue,
  AstRoot,
  Fix,
  Fixer,
  Range,
  ReportDescriptor,
  Scope,
  SourceCode,
  SourceToken,
} from './oxlint-plugin/types';
export { type RuleContext, type Variable } from './oxlint-plugin/types';
