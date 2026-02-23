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

const normalizePath = (value: string): string => value.replaceAll('\\', '/');

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

export { resolveFirebatRootFromCwd };
export type { ResolveFirebatRootResult };
