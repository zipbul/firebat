import { normalizePath } from '@zipbul/gildash';
import * as path from 'node:path';

import { scanGlobsToAbsolutePaths } from './glob-scan';
import { asRecordOrNull as asRecord, isStringArray } from './json-guards';

const readJsoncFile = async (filePathAbs: string): Promise<unknown | null> => {
  try {
    const file = Bun.file(filePathAbs);

    if (!(await file.exists())) {
      return null;
    }

    const text = await file.text();

    return Bun.JSONC.parse(text);
  } catch {
    return null;
  }
};

/**
 * Parse pnpm-workspace.yaml to extract workspace glob patterns.
 * Only handles `packages:` field with YAML list syntax.
 */
const parsePnpmWorkspacePatterns = async (rootAbs: string): Promise<string[]> => {
  try {
    const file = Bun.file(path.join(rootAbs, 'pnpm-workspace.yaml'));

    if (!(await file.exists())) {
      return [];
    }

    const text = await file.text();
    const patterns: string[] = [];
    // Simple YAML list parser: lines starting with `- ` under `packages:` key
    let inPackages = false;

    for (const line of text.split('\n')) {
      const trimmed = line.trim();

      if (trimmed === 'packages:') {
        inPackages = true;

        continue;
      }

      if (inPackages) {
        if (trimmed.startsWith('- ')) {
          const value = trimmed
            .slice(2)
            .trim()
            .replace(/^['"]|['"]$/g, '');

          if (value.length > 0) {
            patterns.push(value);
          }
        } else if (trimmed.length > 0 && !trimmed.startsWith('#')) {
          // New top-level key — stop collecting
          break;
        }
      }
    }

    return patterns;
  } catch {
    return [];
  }
};

/**
 * Discover workspace packages from monorepo root.
 * Supports both package.json `workspaces` field and pnpm-workspace.yaml.
 * @returns Map of package-name → root-absolute-path
 */
const createWorkspacePackageMap = async (rootAbs: string): Promise<Map<string, string>> => {
  const pkgJsonPath = path.join(rootAbs, 'package.json');
  const parsed = await readJsoncFile(pkgJsonPath);
  let patterns: string[] = [];

  if (parsed && typeof parsed === 'object') {
    const parsedRecord = asRecord(parsed);
    const workspacesRaw = parsedRecord?.workspaces;

    if (isStringArray(workspacesRaw)) {
      patterns = workspacesRaw;
    } else if (workspacesRaw && typeof workspacesRaw === 'object') {
      const packages = asRecord(workspacesRaw)?.packages;

      if (isStringArray(packages)) {
        patterns = packages;
      }
    }
  }

  // Fallback to pnpm-workspace.yaml if no patterns from package.json
  if (patterns.length === 0) {
    patterns = await parsePnpmWorkspacePatterns(rootAbs);
  }

  if (patterns.length === 0) {
    return new Map();
  }

  const packageJsonPaths = await scanGlobsToAbsolutePaths(patterns, rootAbs, pattern =>
    normalizePath(path.join(pattern, 'package.json')),
  );
  const map = new Map<string, string>();

  for (const p of packageJsonPaths) {
    const pkg = await readJsoncFile(p);
    const name = typeof asRecord(pkg)?.name === 'string' ? String(asRecord(pkg)?.name) : '';

    if (name.length === 0) {
      continue;
    }

    map.set(name, path.dirname(p));
  }

  return map;
};

export { asRecord, createWorkspacePackageMap, readJsoncFile };
