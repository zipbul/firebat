import * as z from 'zod';

const LOG_LEVELS = ['error', 'warn', 'info', 'debug', 'trace'] as const;

type FirebatLogLevel = (typeof LOG_LEVELS)[number];

type FeatureToggle<TOptions extends Record<string, unknown>> = false | true | TOptions;

type InheritableFeatureToggle<TOptions extends Record<string, unknown>> = false | 'inherit' | true | TOptions;

interface FirebatExactDuplicatesConfig {
  readonly minSize?: number | 'auto' | undefined;
}

interface FirebatStructuralDuplicatesConfig {
  readonly minSize?: number | 'auto' | undefined;
}

interface FirebatWasteConfig {
  readonly memoryRetentionThreshold?: number | undefined;
}

interface FirebatForwardingConfig {
  readonly maxForwardDepth?: number | undefined;
}

interface FirebatUnknownProofConfig {
  readonly boundaryGlobs?: ReadonlyArray<string> | undefined;
}

interface FirebatBarrelPolicyConfig {
  readonly ignoreGlobs?: ReadonlyArray<string> | undefined;
}

interface FirebatFeaturesConfig {
  readonly 'exact-duplicates'?: FeatureToggle<FirebatExactDuplicatesConfig> | undefined;
  readonly waste?: FeatureToggle<FirebatWasteConfig> | undefined;
  readonly 'barrel-policy'?: FeatureToggle<FirebatBarrelPolicyConfig> | undefined;
  readonly 'unknown-proof'?: FeatureToggle<FirebatUnknownProofConfig> | undefined;
  readonly 'exception-hygiene'?: boolean | undefined;
  readonly format?: boolean | undefined;
  readonly lint?: boolean | undefined;
  readonly typecheck?: boolean | undefined;
  readonly dependencies?: boolean | undefined;
  readonly coupling?: boolean | undefined;
  readonly 'structural-duplicates'?: FeatureToggle<FirebatStructuralDuplicatesConfig> | undefined;
  readonly nesting?: boolean | undefined;
  readonly 'early-return'?: boolean | undefined;
  readonly noop?: boolean | undefined;
  readonly 'api-drift'?: boolean | undefined;
  readonly forwarding?: FeatureToggle<FirebatForwardingConfig> | undefined;
}

interface FirebatMcpFeaturesConfig {
  readonly 'exact-duplicates'?: InheritableFeatureToggle<FirebatExactDuplicatesConfig> | undefined;
  readonly waste?: InheritableFeatureToggle<FirebatWasteConfig> | undefined;
  readonly 'barrel-policy'?: InheritableFeatureToggle<FirebatBarrelPolicyConfig> | undefined;
  readonly 'unknown-proof'?: InheritableFeatureToggle<FirebatUnknownProofConfig> | undefined;
  readonly 'exception-hygiene'?: boolean | 'inherit' | undefined;
  readonly format?: boolean | 'inherit' | undefined;
  readonly lint?: boolean | 'inherit' | undefined;
  readonly typecheck?: boolean | 'inherit' | undefined;
  readonly dependencies?: boolean | 'inherit' | undefined;
  readonly coupling?: boolean | 'inherit' | undefined;
  readonly 'structural-duplicates'?: InheritableFeatureToggle<FirebatStructuralDuplicatesConfig> | undefined;
  readonly nesting?: boolean | 'inherit' | undefined;
  readonly 'early-return'?: boolean | 'inherit' | undefined;
  readonly noop?: boolean | 'inherit' | undefined;
  readonly 'api-drift'?: boolean | 'inherit' | undefined;
  readonly forwarding?: InheritableFeatureToggle<FirebatForwardingConfig> | undefined;
}

interface FirebatMcpConfigObject {
  readonly features?: FirebatMcpFeaturesConfig | undefined;
}

type FirebatMcpConfig = 'inherit' | FirebatMcpConfigObject;

interface FirebatConfig {
  readonly $schema?: string | undefined;
  readonly features?: FirebatFeaturesConfig | undefined;
  readonly mcp?: FirebatMcpConfig | undefined;
}

const FirebatConfigSchema: z.ZodType<FirebatConfig> = z
  .object({
    $schema: z.string().optional(),
    features: z
      .object({
        'exact-duplicates': z
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
        waste: z
          .union([
            z.literal(false),
            z.literal(true),
            z
              .object({
                memoryRetentionThreshold: z.number().int().nonnegative().optional(),
              })
              .strict(),
          ])
          .optional(),
        'barrel-policy': z
          .union([
            z.literal(false),
            z.literal(true),
            z
              .object({
                ignoreGlobs: z.array(z.string()).nonempty().optional(),
              })
              .strict(),
          ])
          .optional(),
        'unknown-proof': z
          .union([
            z.literal(false),
            z.literal(true),
            z
              .object({
                boundaryGlobs: z.array(z.string()).nonempty().optional(),
              })
              .strict(),
          ])
          .optional(),
        'exception-hygiene': z.boolean().optional(),
        format: z.boolean().optional(),
        lint: z.boolean().optional(),
        typecheck: z.boolean().optional(),
        dependencies: z.boolean().optional(),
        coupling: z.boolean().optional(),
        'structural-duplicates': z
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
        nesting: z.boolean().optional(),
        'early-return': z.boolean().optional(),
        noop: z.boolean().optional(),
        'api-drift': z.boolean().optional(),
        forwarding: z
          .union([
            z.literal(false),
            z.literal(true),
            z
              .object({
                maxForwardDepth: z.number().int().nonnegative(),
              })
              .strict(),
          ])
          .optional(),
      })
      .strict()
      .optional(),
    mcp: z
      .union([
        z.literal('inherit'),
        z
          .object({
            features: z
              .object({
                'exact-duplicates': z
                  .union([
                    z.literal(false),
                    z.literal('inherit'),
                    z.literal(true),
                    z
                      .object({
                        minSize: z.union([z.literal('auto'), z.number().int().nonnegative()]),
                      })
                      .strict(),
                  ])
                  .optional(),
                waste: z
                  .union([
                    z.literal(false),
                    z.literal('inherit'),
                    z.literal(true),
                    z
                      .object({
                        memoryRetentionThreshold: z.number().int().nonnegative().optional(),
                      })
                      .strict(),
                  ])
                  .optional(),
                'barrel-policy': z
                  .union([
                    z.literal(false),
                    z.literal('inherit'),
                    z.literal(true),
                    z
                      .object({
                        ignoreGlobs: z.array(z.string()).nonempty().optional(),
                      })
                      .strict(),
                  ])
                  .optional(),
                'unknown-proof': z
                  .union([
                    z.literal(false),
                    z.literal('inherit'),
                    z.literal(true),
                    z
                      .object({
                        boundaryGlobs: z.array(z.string()).nonempty().optional(),
                      })
                      .strict(),
                  ])
                  .optional(),
                'exception-hygiene': z.union([z.literal(false), z.literal(true), z.literal('inherit')]).optional(),
                format: z.union([z.literal(false), z.literal(true), z.literal('inherit')]).optional(),
                lint: z.union([z.literal(false), z.literal(true), z.literal('inherit')]).optional(),
                typecheck: z.union([z.literal(false), z.literal(true), z.literal('inherit')]).optional(),
                dependencies: z.union([z.literal(false), z.literal(true), z.literal('inherit')]).optional(),
                coupling: z.union([z.literal(false), z.literal(true), z.literal('inherit')]).optional(),
                'structural-duplicates': z
                  .union([
                    z.literal(false),
                    z.literal('inherit'),
                    z.literal(true),
                    z
                      .object({
                        minSize: z.union([z.literal('auto'), z.number().int().nonnegative()]),
                      })
                      .strict(),
                  ])
                  .optional(),
                nesting: z.union([z.literal(false), z.literal(true), z.literal('inherit')]).optional(),
                'early-return': z.union([z.literal(false), z.literal(true), z.literal('inherit')]).optional(),
                noop: z.union([z.literal(false), z.literal(true), z.literal('inherit')]).optional(),
                'api-drift': z.union([z.literal(false), z.literal(true), z.literal('inherit')]).optional(),
                forwarding: z
                  .union([
                    z.literal(false),
                    z.literal('inherit'),
                    z.literal(true),
                    z
                      .object({
                        maxForwardDepth: z.number().int().nonnegative(),
                      })
                      .strict(),
                  ])
                  .optional(),
              })
              .strict()
              .optional(),
          })
          .strict(),
      ])
      .optional(),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    const { 'exact-duplicates': exact, 'structural-duplicates': structural } = cfg.features ?? {};
    const exactSize = typeof exact === 'object' && exact !== null ? exact.minSize : undefined;
    const structuralSize = typeof structural === 'object' && structural !== null ? structural.minSize : undefined;

    if (exactSize !== undefined && structuralSize !== undefined && exactSize !== structuralSize) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['features', 'structural-duplicates', 'minSize'],
        message: "minSize must match 'features.exact-duplicates.minSize' (shared threshold)",
      });
    }
  });

export type {
  FirebatBarrelPolicyConfig,
  FirebatConfig,
  FirebatExactDuplicatesConfig,
  FirebatFeaturesConfig,
  FirebatForwardingConfig,
  FirebatLogLevel,
  FirebatMcpConfig,
  FirebatMcpConfigObject,
  FirebatMcpFeaturesConfig,
  FirebatStructuralDuplicatesConfig,
  FirebatUnknownProofConfig,
};
export { FirebatConfigSchema };
