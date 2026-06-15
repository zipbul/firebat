import type { FirebatLogger } from './logger';

/**
 * Shared input contract for analyzers that drive an external CLI tool
 * (oxfmt, oxlint, …) over a set of targets.
 *
 * Single source of truth: format and lint analyzers take the identical set of
 * options, so a change to that contract (e.g. a new shared option) must apply
 * to both at once.
 */
export interface ToolAnalysisInput {
  readonly targets: ReadonlyArray<string>;
  readonly fix: boolean;
  readonly configPath?: string;
  readonly cwd?: string;
  readonly resolveMode?: 'default' | 'project-only';
  readonly logger?: FirebatLogger;
}
