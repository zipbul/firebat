import type { FirebatLogger } from '../../shared';

import { getOrmDb } from '../../infrastructure/sqlite/firebat.db';

interface PrepareProjectDbInput {
  readonly rootAbs: string;
  readonly logger: FirebatLogger;
}

/**
 * Prepare the project's firebat database at INSTALL time — creates
 * `.firebat/firebat.sqlite` and runs migrations so the first scan pays no
 * schema-setup latency. Owning this policy here keeps the layering contract
 * intact: adapters call application, application touches infrastructure.
 */
export const prepareProjectDb = async (input: PrepareProjectDbInput): Promise<void> => {
  await getOrmDb({ rootAbs: input.rootAbs, logger: input.logger });

  input.logger.debug('Project DB prepared', { rootAbs: input.rootAbs });
};
