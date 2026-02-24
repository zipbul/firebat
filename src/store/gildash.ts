import { Gildash } from '@zipbul/gildash';
import { isErr } from '@zipbul/result';

interface CreateGildashOptions {
  readonly projectRoot: string;
  readonly watchMode?: boolean;
  readonly extensions?: string[];
}

/** @internal Exposed for unit tests to spy on Gildash.open without mock.module. */
export const __testing__ = {
  open: Gildash.open.bind(Gildash) as typeof Gildash.open,
};

const createGildash = async (opts: CreateGildashOptions): Promise<Gildash> => {
  const result = await __testing__.open({
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
