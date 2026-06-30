import { normalizePath } from '@zipbul/gildash';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as z from 'zod';

interface PackageJson {
  readonly name?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

const PackageJsonSchema = z.looseObject({
  name: z.string().optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
  peerDependencies: z.record(z.string(), z.string()).optional(),
});

const readPackageJson = async (dirAbs: string): Promise<PackageJson | null> => {
  const filePath = path.join(dirAbs, 'package.json');

  try {
    const raw = await Bun.file(filePath).text();
    const parsed = PackageJsonSchema.safeParse(JSON.parse(raw));

    if (!parsed.success) {
      return null;
    }

    return {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.dependencies !== undefined ? { dependencies: parsed.data.dependencies } : {}),
      ...(parsed.data.devDependencies !== undefined ? { devDependencies: parsed.data.devDependencies } : {}),
      ...(parsed.data.peerDependencies !== undefined ? { peerDependencies: parsed.data.peerDependencies } : {}),
    };
  } catch {
    return null;
  }
};

const hasDepNamed = (pkg: PackageJson, depName: string): boolean => {
  const bags = [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies];

  for (const bag of bags) {
    if (!bag) {
      continue;
    }

    if (depName in bag) {
      return true;
    }
  }

  return false;
};

const isExistingDir = async (dirAbs: string): Promise<boolean> => {
  try {
    const s = await Bun.file(dirAbs).stat();

    return s.isDirectory();
  } catch {
    return false;
  }
};

const resolveParent = (dirAbs: string): string | null => {
  const parent = path.dirname(dirAbs);

  return parent === dirAbs ? null : parent;
};

const isWithinNodeModules = (dirAbs: string): boolean => {
  const normalized = normalizePath(dirAbs);

  // Handles npm/yarn/pnpm layouts, including:
  // - <root>/node_modules/firebat
  // - <root>/node_modules/.pnpm/<...>/node_modules/firebat
  return normalized.split('/').includes('node_modules');
};

interface ResolveFirebatRootResult {
  readonly rootAbs: string;
  readonly reason: 'declared-dependency' | 'self-repo';
}

const resolveFirebatRootFromCwd = async (startDirAbs: string = process.cwd()): Promise<ResolveFirebatRootResult> => {
  let current = path.resolve(startDirAbs);

  while (await isExistingDir(current)) {
    const pkg = await readPackageJson(current);

    if (pkg) {
      const name = pkg.name ?? '';

      if (name === 'firebat') {
        // If we're executing from within an installed package (node_modules),
        // don't treat it as the target project root. Keep walking upward to
        // find the real project that declares firebat as a dependency.
        if (!isWithinNodeModules(current)) {
          return { rootAbs: current, reason: 'self-repo' };
        }
      }

      if (hasDepNamed(pkg, 'firebat')) {
        return { rootAbs: current, reason: 'declared-dependency' };
      }
    }

    const parent = resolveParent(current);

    if (parent === null) {
      break;
    }

    current = parent;
  }

  throw new Error(
    `[firebat] Could not locate a package.json that declares firebat (startDir=${path.resolve(startDirAbs)}). ` +
      'Run within the package that depends on firebat.',
  );
};

/** Resolve symlinks to a canonical absolute path; fall back to the input if it doesn't exist. */
const realpathSafe = (p: string): string => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};

/**
 * True when `childAbs` is `rootAbs` itself or lives underneath it. Compares
 * canonical (realpath + normalized) paths via `path.relative` so that symlinks
 * (`/tmp` → `/private/tmp`, pnpm `.pnpm` links) and prefix collisions
 * (`/proj` vs `/proj-other`) are handled correctly.
 */
const isWithinRoot = (childAbs: string, rootAbs: string): boolean => {
  const root = normalizePath(realpathSafe(rootAbs));
  const child = normalizePath(realpathSafe(childAbs));

  if (child === root) {
    return true;
  }

  const rel = path.relative(root, child);

  return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/**
 * Global correctness gate: every scan target must live within `rootAbs` so that
 * the single Gildash instance (opened with `projectRoot: rootAbs`) actually
 * indexes them. A target outside the root would silently miss the index and
 * corrupt every gildash-dependent detector — fail fast instead.
 */
const assertTargetsWithinRoot = (targetsAbs: ReadonlyArray<string>, rootAbs: string): void => {
  const outside = targetsAbs.filter(t => !isWithinRoot(t, rootAbs));

  if (outside.length === 0) {
    return;
  }

  const sample = outside.slice(0, 3).join(', ');
  const more = outside.length > 3 ? ` (and ${outside.length - 3} more)` : '';

  throw new Error(
    `[firebat] ${outside.length} target(s) are outside the project root ${rootAbs}: ${sample}${more}. ` +
      'Gildash indexes only files under the root, so out-of-root targets would produce wrong results. ' +
      'Run firebat within — or pass --cwd pointing at — the project that contains the targets.',
  );
};

export type { ResolveFirebatRootResult };

export { assertTargetsWithinRoot, isWithinRoot, resolveFirebatRootFromCwd };
