import { Gildash, type GildashOptions } from '@zipbul/gildash';
import { isErr } from '@zipbul/result';

interface CreateGildashOptions {
  readonly projectRoot: string;
  readonly watchMode?: boolean;
  readonly extensions?: string[];
}

const createGildash = async (opts: CreateGildashOptions): Promise<Gildash> => {
  const result = await Gildash.open({
    projectRoot: opts.projectRoot,
    watchMode: opts.watchMode ?? false,
    extensions: opts.extensions ?? ['.ts', '.mts', '.cts', '.tsx'],
  });
  if (isErr(result)) {
    throw new Error(`Gildash open failed: ${result.data.message}`);
  }
  return result;
};

export { createGildash };
export type { CreateGildashOptions };
