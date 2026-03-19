import type { FirebatCouplingConfig, FirebatLogLevel } from './shared/firebat-config';
import type { FirebatDetector, MinSizeOption, OutputFormat } from './types';

export interface FirebatCliExplicitFlags {
  readonly format: boolean;
  readonly minSize: boolean;
  readonly maxForwardDepth: boolean;
  readonly crossFileMinDepth: boolean;
  readonly exitOnFindings: boolean;
  readonly detectors: boolean;
  readonly fix: boolean;
  readonly configPath: boolean;
  readonly logLevel: boolean;
  readonly logStack: boolean;
}

export interface FirebatCliOptions {
  readonly targets: readonly string[];
  readonly format: OutputFormat;
  readonly minSize: MinSizeOption;
  readonly maxForwardDepth: number;
  readonly crossFileMinDepth?: number;
  readonly exitOnFindings: boolean;
  readonly detectors: ReadonlyArray<FirebatDetector>;
  readonly fix: boolean;
  readonly barrelPolicyIgnoreGlobs?: ReadonlyArray<string>;
  readonly dependenciesLayers?: ReadonlyArray<{ readonly name: string; readonly glob: string }>;
  readonly dependenciesAllowedDependencies?: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly couplingConfig?: FirebatCouplingConfig;
  readonly help: boolean;
  readonly configPath?: string;
  readonly logLevel?: FirebatLogLevel;
  readonly logStack?: boolean;
  readonly explicit?: FirebatCliExplicitFlags;
}

export interface FirebatProgramConfig {
  readonly targets: readonly string[];
  readonly logger: import('./shared/logger').FirebatLogger;
}
