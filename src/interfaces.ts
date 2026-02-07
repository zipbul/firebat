import type { FirebatDetector, MinSizeOption, OutputFormat } from './types';
import type { FirebatLogLevel } from './firebat-config';

export interface FirebatCliExplicitFlags {
  readonly format: boolean;
  readonly minSize: boolean;
  readonly maxForwardDepth: boolean;
  readonly exitOnFindings: boolean;
  readonly detectors: boolean;
  readonly fix: boolean;
  readonly configPath: boolean;
  readonly logLevel: boolean;
}

export interface FirebatCliOptions {
  readonly targets: readonly string[];
  readonly format: OutputFormat;
  readonly minSize: MinSizeOption;
  readonly maxForwardDepth: number;
  readonly exitOnFindings: boolean;
  readonly detectors: ReadonlyArray<FirebatDetector>;
  readonly fix: boolean;
  readonly unknownProofBoundaryGlobs?: ReadonlyArray<string>;
  readonly barrelPolicyIgnoreGlobs?: ReadonlyArray<string>;
  readonly help: boolean;
  readonly configPath?: string;
  readonly logLevel?: FirebatLogLevel;
  readonly explicit?: FirebatCliExplicitFlags;
}

export interface FirebatProgramConfig {
  readonly targets: readonly string[];
}
