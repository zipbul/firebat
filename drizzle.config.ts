import { defineConfig } from 'drizzle-kit';
import * as path from 'node:path';

const here = import.meta.dir;
const repoRoot = path.resolve(here, '../..');
const drizzleConfig = defineConfig({
  dialect: 'sqlite',
  schema: path.resolve(here, './src/infrastructure/sqlite/schema.ts'),
  out: path.resolve(here, './src/infrastructure/sqlite/migrations'),
  dbCredentials: {
    url: path.resolve(repoRoot, './.firebat/firebat.sqlite'),
  },
});

export { drizzleConfig };
