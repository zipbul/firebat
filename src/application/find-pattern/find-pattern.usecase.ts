import * as path from 'node:path';

import type { FirebatLogger } from '../../ports/logger';

import { findPatternInFiles, type AstGrepMatch } from '../../infrastructure/ast-grep/find-pattern';
import { discoverDefaultTargets } from '../../target-discovery';

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

const uniqueSorted = (values: ReadonlyArray<string>): string[] => Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));

const shouldIncludeSourceFile = (filePath: string): boolean => {
  const normalized = filePath.replaceAll('\\', '/');

  if (normalized.includes('node_modules')) {
    return false;
  }

  if (normalized.endsWith('.d.ts')) {
    return false;
  }

  return normalized.endsWith('.ts') || normalized.endsWith('.tsx') || normalized.endsWith('.js') || normalized.endsWith('.jsx');
};

const scanDirForSourceFiles = async (dirAbs: string): Promise<string[]> => {
  if (dirAbs.trim().length === 0) {
    return [];
  }

  const out: string[] = [];

  for (const pattern of ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx']) {
    const glob = new Bun.Glob(pattern);

    for await (const relPath of glob.scan({ cwd: dirAbs, onlyFiles: true, followSymlinks: false })) {
      out.push(path.resolve(dirAbs, relPath));
    }
  }

  return out.filter(shouldIncludeSourceFile);
};

const expandTargets = async (cwd: string, targets: ReadonlyArray<string>): Promise<string[]> => {
  if (targets.length === 0) {
    return [];
  }

  const results: string[] = [];

  for (const raw of targets) {
    const abs = path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
    const stat = await Bun.file(abs)
      .stat()
      .catch(() => null);

    if (stat?.isDirectory()) {
      const files = await scanDirForSourceFiles(abs);

      results.push(...files);

      continue;
    }

    if (stat?.isFile()) {
      results.push(abs);

      continue;
    }

    // Glob pattern
    if (raw.includes('*')) {
      const glob = new Bun.Glob(raw);

      for await (const filePath of glob.scan({ cwd, onlyFiles: true, followSymlinks: false })) {
        results.push(path.resolve(cwd, filePath));
      }
      continue;
    }

    // Plain file fallback (only if it exists)
    if (await Bun.file(abs).exists()) {
      results.push(abs);
    }
  }

  return uniqueSorted(results);
};

const findPatternUseCase = async (input: FindPatternInput): Promise<ReadonlyArray<AstGrepMatch>> => {
  const { logger } = input;
  const cwd = process.cwd();
  const targetsRaw = input.targets !== undefined && input.targets.length > 0 ? input.targets : await discoverDefaultTargets(cwd);
  const targets = await expandTargets(cwd, targetsRaw);

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
