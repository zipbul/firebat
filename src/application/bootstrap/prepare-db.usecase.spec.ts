import { describe, expect, it, mock } from 'bun:test';

import { createNoopLogger } from '../../shared/logger';

// Mock the infrastructure seam: the usecase's contract is "opens the ORM DB for
// rootAbs (side effect: file + migrations) and resolves".
const getOrmDbMock = mock(async (_input: unknown) => ({}) as never);

void mock.module('../../infrastructure/sqlite/firebat.db', () => ({
  getOrmDb: getOrmDbMock,
}));

const { prepareProjectDb } = await import('./prepare-db.usecase');

describe('application/bootstrap — prepareProjectDb', () => {
  it('opens the project ORM DB for the given root (migrations side effect)', async () => {
    getOrmDbMock.mockClear();

    const logger = createNoopLogger();

    await prepareProjectDb({ rootAbs: '/proj', logger });

    expect(getOrmDbMock).toHaveBeenCalledTimes(1);
    expect((getOrmDbMock.mock.calls[0] as unknown[])[0]).toEqual({ rootAbs: '/proj', logger });
  });

  it('propagates an open failure to the caller (no swallow)', async () => {
    getOrmDbMock.mockImplementationOnce(async () => {
      throw new Error('disk full');
    });

    await expect(prepareProjectDb({ rootAbs: '/proj', logger: createNoopLogger() })).rejects.toThrow('disk full');
  });
});
