import * as z from 'zod';

import type { DependencyLayerRule } from './dependency-layer-rule';

const LOG_LEVELS = ['error', 'warn', 'info', 'debug', 'trace'] as const;

type FirebatLogLevel = (typeof LOG_LEVELS)[number];

type FeatureToggle<TOptions> = false | true | TOptions;

/**
 * Feature 토글(`false | true | Options`)에서 옵션 객체 형태만 뽑아낸다.
 * boolean/undefined면 null. detector별 옵션 해석이 공유하는 "토글을 옵션으로" 단일 결정.
 */
const featureOptions = <TOptions>(toggle: FeatureToggle<TOptions> | undefined): TOptions | null =>
  typeof toggle === 'object' && toggle !== null ? toggle : null;

interface FirebatDuplicatesConfig {
  readonly minSize?: number | 'auto' | undefined;
}

interface FirebatIndirectionConfig {
  readonly maxForwardDepth?: number | undefined;
  readonly crossFileMinDepth?: number | undefined;
}

interface FirebatVariableLifetimeConfig {
  readonly maxLifetimeLines?: number | undefined;
  readonly maxLiveVariables?: number | undefined;
  readonly minFunctionLines?: number | undefined;
  readonly maxMutationCount?: number | undefined;
}

interface FirebatGiantFileConfig {
  readonly maxLines?: number | undefined;
}

interface FirebatNestingConfig {
  readonly maxCognitiveComplexity?: number | undefined;
  readonly maxCallbackDepth?: number | undefined;
  readonly maxPromiseChainDepth?: number | undefined;
  readonly maxNestingDepth?: number | undefined;
  readonly minDensityLoc?: number | undefined;
  readonly maxDensity?: number | undefined;
}

interface FirebatCouplingConfig {
  readonly godModulePercent?: number | undefined;
  readonly godModuleMin?: number | undefined;
  readonly rigidPercent?: number | undefined;
  readonly rigidMin?: number | undefined;
  readonly distanceThreshold?: number | undefined;
  readonly unstableInstability?: number | undefined;
  readonly unstableFanOut?: number | undefined;
  readonly rigidInstability?: number | undefined;
}

interface FirebatBarrelConfig {
  readonly ignoreGlobs?: ReadonlyArray<string> | undefined;
}

interface FirebatDependenciesConfig {
  readonly layers: ReadonlyArray<DependencyLayerRule>;
  readonly allowedDependencies: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly entry?: ReadonlyArray<string> | undefined;
  readonly ignore?: ReadonlyArray<string> | undefined;
}

interface FirebatFeaturesConfig {
  readonly duplicates?: FeatureToggle<FirebatDuplicatesConfig> | undefined;
  readonly waste?: boolean | undefined;
  readonly barrel?: FeatureToggle<FirebatBarrelConfig> | undefined;
  readonly 'error-flow'?: boolean | undefined;
  readonly format?: boolean | undefined;
  readonly lint?: boolean | undefined;
  readonly typecheck?: boolean | undefined;
  readonly dependencies?: FeatureToggle<FirebatDependenciesConfig> | undefined;
  readonly coupling?: FeatureToggle<FirebatCouplingConfig> | undefined;
  readonly nesting?: FeatureToggle<FirebatNestingConfig> | undefined;
  readonly 'early-return'?: boolean | undefined;
  readonly 'collapsible-if'?: boolean | undefined;
  readonly indirection?: FeatureToggle<FirebatIndirectionConfig> | undefined;

  // Phase 1 detectors (IMPROVE.md)
  readonly 'temporal-coupling'?: boolean | undefined;
  readonly 'variable-lifetime'?: FeatureToggle<FirebatVariableLifetimeConfig> | undefined;
  readonly 'giant-file'?: FeatureToggle<FirebatGiantFileConfig> | undefined;
}

interface FirebatConfig {
  readonly $schema?: string | undefined;
  readonly features?: FirebatFeaturesConfig | undefined;
  readonly exclude?: ReadonlyArray<string> | undefined;
}

const FirebatConfigSchema: z.ZodType<FirebatConfig> = z
  .object({
    $schema: z.string().optional(),
    exclude: z.array(z.string()).optional(),
    features: z
      .object({
        duplicates: z
          .union([
            z.literal(false),
            z.literal(true),
            z
              .object({
                minSize: z.union([z.literal('auto'), z.number().int().nonnegative()]),
              })
              .strict(),
          ])
          .optional(),
        waste: z.boolean().optional(),
        barrel: z
          .union([
            z.literal(false),
            z.literal(true),
            z
              .object({
                ignoreGlobs: z.array(z.string()).optional(),
              })
              .strict(),
          ])
          .optional(),
        'error-flow': z.boolean().optional(),
        format: z.boolean().optional(),
        lint: z.boolean().optional(),
        typecheck: z.boolean().optional(),
        dependencies: z
          .union([
            z.literal(false),
            z.literal(true),
            z
              .object({
                layers: z
                  .array(
                    z
                      .object({
                        name: z.string().min(1),
                        glob: z.string().min(1),
                      })
                      .strict(),
                  )
                  .nonempty(),
                allowedDependencies: z.record(z.string(), z.array(z.string())),
                entry: z.array(z.string()).optional(),
                ignore: z.array(z.string()).optional(),
              })
              .strict(),
          ])
          .optional(),
        coupling: z
          .union([
            z.literal(false),
            z.literal(true),
            z
              .object({
                godModulePercent: z.number().min(0).max(1).optional(),
                godModuleMin: z.number().int().nonnegative().optional(),
                rigidPercent: z.number().min(0).max(1).optional(),
                rigidMin: z.number().int().nonnegative().optional(),
                distanceThreshold: z.number().min(0).max(1).optional(),
                unstableInstability: z.number().min(0).max(1).optional(),
                unstableFanOut: z.number().int().nonnegative().optional(),
                rigidInstability: z.number().min(0).max(1).optional(),
              })
              .strict(),
          ])
          .optional(),
        nesting: z
          .union([
            z.literal(false),
            z.literal(true),
            z
              .object({
                maxCognitiveComplexity: z.number().int().nonnegative().optional(),
                maxCallbackDepth: z.number().int().nonnegative().optional(),
                maxPromiseChainDepth: z.number().int().nonnegative().optional(),
                maxNestingDepth: z.number().int().nonnegative().optional(),
                minDensityLoc: z.number().int().nonnegative().optional(),
                maxDensity: z.number().min(0).max(1).optional(),
              })
              .strict(),
          ])
          .optional(),
        'early-return': z.boolean().optional(),
        'collapsible-if': z.boolean().optional(),
        indirection: z
          .union([
            z.literal(false),
            z.literal(true),
            z
              .object({
                maxForwardDepth: z.number().int().nonnegative().optional(),
                crossFileMinDepth: z.number().int().min(1).optional(),
              })
              .strict(),
          ])
          .optional(),

        'temporal-coupling': z.boolean().optional(),
        'variable-lifetime': z
          .union([
            z.literal(false),
            z.literal(true),
            z
              .object({
                maxLifetimeLines: z.number().int().nonnegative().optional(),
                maxLiveVariables: z.number().int().nonnegative().optional(),
                minFunctionLines: z.number().int().nonnegative().optional(),
                maxMutationCount: z.number().int().nonnegative().optional(),
              })
              .strict(),
          ])
          .optional(),
        'giant-file': z
          .union([
            z.literal(false),
            z.literal(true),
            z
              .object({
                maxLines: z.number().int().nonnegative().optional(),
              })
              .strict(),
          ])
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type { FirebatConfig, FirebatCouplingConfig, FirebatLogLevel };

export { featureOptions, FirebatConfigSchema };
