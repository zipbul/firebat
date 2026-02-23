import type { FirebatLogger } from '../../ports/logger';

import { findPatternInFiles, type AstGrepMatch } from '../../tooling/ast-grep/find-pattern';
import { resolveTargets } from '../../target-discovery';

interface JsonObject {
  readonly [k: string]: JsonValue;
}

type JsonValue = null | boolean | number | string | ReadonlyArray<JsonValue> | JsonObject;

interface FindPatternInput {
  readonly targets?: ReadonlyArray<string>;
  readonly rule?: JsonValue;
  readonly matcher?: JsonValue;
  readonly ruleName?: string;
  readonly logger: FirebatLogger;
}

const findPatternUseCase = async (input: FindPatternInput): Promise<ReadonlyArray<AstGrepMatch>> => {
  const { logger } = input;
  const cwd = process.cwd();
  const targets = await resolveTargets(cwd, input.targets);

  logger.debug('find-pattern: searching', { ruleName: input.ruleName, targetCount: targets.length });

  const request: Parameters<typeof findPatternInFiles>[0] = { targets, logger };

  if (input.rule !== undefined) {
    request.rule = input.rule;
  }

  if (input.matcher !== undefined) {
    request.matcher = input.matcher;
  }

  if (input.ruleName !== undefined) {
    request.ruleName = input.ruleName;
  }

  return findPatternInFiles(request);
};

export { findPatternUseCase };
