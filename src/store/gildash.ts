import { Gildash, GildashError } from '@zipbul/gildash';

interface CreateGildashOptions {
  readonly projectRoot: string;
  readonly watchMode?: boolean;
  readonly extensions?: string[];
  readonly semantic?: boolean;
  readonly ignorePatterns?: string[];
}

/** @internal Exposed for unit tests to spy on Gildash.open without mock.module. */
export const __testing__ = {
  open: Gildash.open.bind(Gildash) as typeof Gildash.open,
};

const createGildash = async (opts: CreateGildashOptions): Promise<Gildash> => {
  try {
    return await __testing__.open({
      projectRoot: opts.projectRoot,
      watchMode: opts.watchMode ?? false,
      extensions: opts.extensions ?? ['.ts', '.mts', '.cts', '.tsx'],
      ...(opts.semantic === true ? { semantic: true } : {}),
      ...(opts.ignorePatterns ? { ignorePatterns: opts.ignorePatterns } : {}),
    });
  } catch (e) {
    const msg = e instanceof GildashError ? e.message : String(e);

    throw new Error(`Gildash open failed: ${msg}`, { cause: e });
  }
};

export { createGildash };
