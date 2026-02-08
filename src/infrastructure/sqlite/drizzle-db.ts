import type { Database } from 'bun:sqlite';

import { drizzle } from 'drizzle-orm/bun-sqlite';

import * as schema from './schema';

const createDrizzleDb = (client: Database) => drizzle({ client, schema });

export type FirebatDrizzleDb = ReturnType<typeof createDrizzleDb>;
export { createDrizzleDb };
