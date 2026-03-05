import type { PatternMatch } from '@zipbul/gildash';
import { GildashError } from '@zipbul/gildash';

import { createGildash } from '../../store/gildash';
import { resolveTargets } from '../../shared/target-discovery';
import type { FirebatLogger } from '../../shared/logger';

interface FindPatternInput {
  readonly targets?: ReadonlyArray<string>;
  readonly pattern: string;
  readonly logger: FirebatLogger;
  readonly rootAbs?: string;
}

const findPatternUseCase = async (
  input: FindPatternInput,
): Promise<ReadonlyArray<PatternMatch>> => {
  const { logger, pattern } = input;
  const root = input.rootAbs ?? process.cwd();
  const filePaths = await resolveTargets(root, input.targets);

  logger.debug('find-pattern: searching', { pattern, targetCount: filePaths.length });

  if (filePaths.length === 0) return [];

  const gildash = await createGildash({ projectRoot: root, watchMode: false });
  try {
    return await gildash.findPattern(pattern, { filePaths });
  } catch (e) {
    if (e instanceof GildashError) {
      logger.debug('find-pattern: error', { message: e.message });
      return [];
    }
    throw e;
  } finally {
    await gildash.close({ cleanup: true });
  }
};

export { findPatternUseCase };
export type { FindPatternInput };
