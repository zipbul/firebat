import type { FirebatLogLevel } from './shared';
import type { FirebatDetector, MinSizeOption } from './types';

export interface FirebatCliExplicitFlags {
  readonly minSize: boolean;
  readonly maxForwardDepth: boolean;
  readonly crossFileMinDepth: boolean;
  readonly detectors: boolean;
  readonly configPath: boolean;
  readonly logLevel: boolean;
  readonly logStack: boolean;
}

export interface FirebatCliOptions {
  readonly targets: readonly string[];
  readonly minSize: MinSizeOption;
  readonly maxForwardDepth: number;
  readonly crossFileMinDepth?: number;
  readonly detectors: ReadonlyArray<FirebatDetector>;
  readonly barrelIgnoreGlobs?: ReadonlyArray<string>;
  readonly dependenciesLayers?: ReadonlyArray<{ readonly name: string; readonly glob: string }>;
  readonly dependenciesAllowedDependencies?: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly dependenciesEntry?: ReadonlyArray<string>;
  readonly dependenciesIgnore?: ReadonlyArray<string>;
  readonly dependenciesIgnoreDeps?: ReadonlyArray<string>;
  readonly exclude?: ReadonlyArray<string>;
  readonly help: boolean;
  readonly configPath?: string;
  /** Resolution start directory (default process.cwd()); set via --cwd/-C or FIREBAT_CWD. */
  readonly cwd?: string;
  readonly logLevel?: FirebatLogLevel;
  readonly logStack?: boolean;
  readonly explicit?: FirebatCliExplicitFlags;
}

export interface FirebatProgramConfig {
  readonly targets: readonly string[];
  readonly logger: import('./shared/logger').FirebatLogger;
  /** Project root for an own-gildash open (standalone callers). Ignored when gildash is injected. */
  readonly rootAbs?: string;
}
