import type { Gildash, SymbolDetail } from '@zipbul/gildash';

import { GildashError, normalizePath } from '@zipbul/gildash';
import { builtinModules } from 'node:module';
import * as path from 'node:path';
import ts from 'typescript';

import type { DependencyLayerRule } from '../../shared';
import type {
  DependencyAnalysis,
  DependencyDeadExportFinding,
  DependencyEdgeCutHint,
  DependencyLayerViolation,
  DependencyUnusedFileFinding,
  DependencyUnusedDepFinding,
  DependencyUnresolvedImportFinding,
  DependencyDuplicateExportFinding,
  DependencyUnusedMemberFinding,
  SourceSpan,
} from '../../types';

import { addToSetMap, globToRegExp, pushToMultiMap, resolveAbs } from '../../shared';

/* ------------------------------------------------------------------ */
/*  Utilities                                                          */
/* ------------------------------------------------------------------ */

const createEmptyDependencies = (): DependencyAnalysis => ({
  cycles: [],
  adjacency: {},
  cuts: [],
  layerViolations: [],
  deadExports: [],
  unusedFiles: [],
  unusedDeps: [],
  unresolvedImports: [],
  duplicateExports: [],
  unusedMembers: [],
});

const toRelativePath = (rootAbs: string, value: string): string => normalizePath(path.relative(rootAbs, value));

/* ------------------------------------------------------------------ */
/*  Layer matching                                                     */
/* ------------------------------------------------------------------ */

interface AnalyzeDependenciesInput {
  readonly rootAbs?: string;
  readonly layers?: ReadonlyArray<DependencyLayerRule>;
  readonly allowedDependencies?: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly readFileFn?: (path: string) => string;
  /**
   * List a directory's entry names (used to enumerate root-level `tsconfig*.json` for ambient-type
   * resolution). Injected fs-backed in prod; omitted in unit tests → only the explicit `tsconfig.json`
   * is read. A failing/absent lister yields no extra configs (widen-only — never a false W).
   */
  readonly listDirFn?: (dir: string) => ReadonlyArray<string>;
  /** Workspace package map (name → rootAbs) for monorepo support. When provided, unused/unlisted dep analysis runs per workspace. */
  readonly workspacePackages?: ReadonlyMap<string, string>;
  /** Glob patterns for dependencies to ignore in unused dependency detection. */
  readonly ignoreDependencies?: ReadonlyArray<string>;
  /**
   * Additional entry-point globs (root-relative). Files matching become reachability roots,
   * augmenting the entrypoints auto-detected from package.json. A user-declared FACT.
   */
  readonly entry?: ReadonlyArray<string>;
  /**
   * Globs (root-relative) of files excluded from `unused-file` reporting — the user declares
   * these are not orphans (e.g. framework-loaded files the static graph cannot see). A FACT.
   */
  readonly ignore?: ReadonlyArray<string>;
}

const compileLayerMatchers = (
  layers: ReadonlyArray<DependencyLayerRule>,
): ReadonlyArray<{ readonly layer: DependencyLayerRule; readonly re: RegExp }> => {
  return layers
    .filter(
      layer =>
        typeof layer.name === 'string' &&
        layer.name.trim().length > 0 &&
        typeof layer.glob === 'string' &&
        layer.glob.trim().length > 0,
    )
    .map(layer => ({ layer, re: globToRegExp(layer.glob) }));
};

const matchLayerName = (
  rootAbs: string,
  fileAbs: string,
  matchers: ReadonlyArray<{ readonly layer: DependencyLayerRule; readonly re: RegExp }>,
): string | null => {
  const rel = toRelativePath(rootAbs, fileAbs);

  if (rel.startsWith('..')) {
    return null;
  }

  for (const entry of matchers) {
    if (entry.re.test(rel)) {
      return entry.layer.name;
    }
  }

  return null;
};

/* ------------------------------------------------------------------ */
/*  Package helpers                                                    */
/* ------------------------------------------------------------------ */

/** Extract package name from import specifier (e.g. `lodash/merge` → `lodash`, `@scope/pkg/sub` → `@scope/pkg`). */
const extractPackageName = (specifier: string): string | null => {
  if (specifier.length === 0 || specifier.startsWith('.') || specifier.startsWith('/')) {
    return null;
  }

  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');

    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  }

  return specifier.split('/')[0] ?? null;
};

// `node:`/`bun:`-prefixed and the bare `bun` specifier are ALWAYS the runtime, never a package —
// excluded from the external-package set entirely.
const isPrefixedBuiltin = (name: string): boolean => name === 'bun' || name.startsWith('node:') || name.startsWith('bun:');

// Node exposes its core modules as a runtime FACT via `module.builtinModules` (bare names like
// `path`/`fs`, no prefix). A BARE builtin name is ambiguous: Node resolves it to core, but a
// bundler/browser target may resolve a same-named npm polyfill (`buffer`, `events`, `punycode`).
// So a bare builtin is not reported as an unlisted dependency, but — unlike a prefixed builtin — it
// is still collected into the external set: if it is DECLARED, the declaration is a fact of intent
// (the polyfill), so it must count as used (else a declared polyfill would false-W as unused). The
// target environment is not a readable fact → hold that direction.
const NODE_BUILTIN_MODULES = new Set(builtinModules);

const isBuiltinModule = (name: string): boolean => isPrefixedBuiltin(name) || NODE_BUILTIN_MODULES.has(name);

/** Read and JSON-parse the package.json under `rootAbs`. Callers wrap this in their own try/catch fallbacks. */
const readPackageJson = (rootAbs: string, readFn: (p: string) => string): Record<string, unknown> =>
  JSON.parse(readFn(path.join(rootAbs, 'package.json'))) as Record<string, unknown>;

const collectDependencyFields = (rootAbs: string, readFn: (p: string) => string, fields: ReadonlyArray<string>): Set<string> => {
  try {
    const parsed = readPackageJson(rootAbs, readFn);
    const deps = new Set<string>();

    for (const field of fields) {
      const section = parsed[field];

      if (section && typeof section === 'object' && !Array.isArray(section)) {
        for (const key of Object.keys(section as Record<string, unknown>)) {
          deps.add(key);
        }
      }
    }

    return deps;
  } catch {
    return new Set();
  }
};

/**
 * Declared runtime/dev dependencies (unused-dependency baseline). peer/optional
 * are excluded: a consumer installs those, so an unused peer/optional is not a W.
 */
const readPackageDependencies = (rootAbs: string, readFn: (p: string) => string): Set<string> =>
  collectDependencyFields(rootAbs, readFn, ['dependencies', 'devDependencies']);

/**
 * Every declared dependency field (unlisted-dependency baseline). npm semantics:
 * a package declared under any of dependencies/devDependencies/peerDependencies/
 * optionalDependencies is "declared" and must not be flagged as unlisted.
 */
const readDeclaredPackages = (rootAbs: string, readFn: (p: string) => string): Set<string> =>
  collectDependencyFields(rootAbs, readFn, ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']);

/**
 * Whether a declared dep exposes a binary via its installed package.json `bin` field — a
 * declared contract (fact). Tri-state, because install layout is NOT a fact firebat controls:
 *   - `'bin'`     manifest read and has a non-empty `bin` → executable package.
 *   - `'no-bin'`  manifest read and has no/empty `bin`    → pure library.
 *   - `'unknown'` no manifest readable in the walk        → install-state cannot confirm.
 *
 * An executable package can be invoked by a script, a git hook, `bunx`, or a human — none of
 * which the static import graph observes — so a `'bin'` dep's non-use cannot be proven. We do
 * NOT parse scripts to guess "is it the executed binary": shell grammar (env prefixes,
 * `cross-env`, subshells, path/`.bin` invocation, wrappers) does not close, and every missed
 * form would be a false W. Bin-existence is the closed fact that supersedes it.
 *
 * `'unknown'` MUST be treated like `'bin'` (hold): pnpm's non-flat store, Yarn PnP (no
 * `node_modules` at all), and monorepo hoisting above `rootAbs` all leave the manifest
 * unreadable here while the dep genuinely ships a binary. Reporting on absence-of-manifest
 * would smuggle install-state in as evidence for a W — forbidden. Per "닫히지 않으면 보류",
 * unknown → hold (FN). The manifest is resolved from the workspace dir up to the project root.
 */
const readDepBinState = (
  depRoot: string,
  rootAbs: string,
  dep: string,
  readFn: (p: string) => string,
): 'bin' | 'no-bin' | 'unknown' => {
  let dir = depRoot;

  for (;;) {
    try {
      const bin = readPackageJson(path.join(dir, 'node_modules', dep), readFn).bin;
      const hasBin =
        typeof bin === 'string'
          ? bin.length > 0
          : Boolean(bin) && typeof bin === 'object' && !Array.isArray(bin) && Object.keys(bin as object).length > 0;

      return hasBin ? 'bin' : 'no-bin';
    } catch {
      if (dir === rootAbs) {
        return 'unknown';
      }

      const parent = path.dirname(dir);

      // Walk toward the project root (clamped) so npm-hoisted manifests are still found.
      dir = parent.length < rootAbs.length ? rootAbs : parent;
    }
  }
};

const readPackageName = (rootAbs: string, readFn: (p: string) => string): string | null => {
  try {
    const parsed = readPackageJson(rootAbs, readFn);

    return typeof parsed.name === 'string' ? parsed.name : null;
  } catch {
    return null;
  }
};

/* ------------------------------------------------------------------ */
/*  Ambient type-package resolution (tsconfig `types` + triple-slash)  */
/* ------------------------------------------------------------------ */

/** The owner package name (root) of a `types`/reference specifier (`foo/sub` → `foo`, `@s/p/x` → `@s/p`). */
const packageRoot = (spec: string): string => {
  const segs = spec.split('/');

  return spec.startsWith('@') ? segs.slice(0, 2).join('/') : segs[0]!;
};

/** DefinitelyTyped scoped-name mangling: `@scope/pkg` → `scope__pkg` (`@types/scope__pkg`). */
const mangleScoped = (pkg: string): string => (pkg.startsWith('@') ? pkg.slice(1).replace('/', '__') : pkg);

/** Every hold key a `types`/reference entry `spec` contributes (widen-only): itself, its owner root, and the `@types` stub. */
const ambientKeysFor = (spec: string, out: Set<string>): void => {
  const root = packageRoot(spec);

  out.add(spec);
  out.add(root);
  out.add(`@types/${mangleScoped(root)}`);
};

/** A `ts.ParseConfigHost` over the injected `readFn` (no real fs; missing file → undefined/false). */
const makeParseConfigHost = (readFn: (p: string) => string): ts.ParseConfigHost => ({
  useCaseSensitiveFileNames: true,
  readDirectory: () => [],
  fileExists: (p: string): boolean => {
    try {
      readFn(p);

      return true;
    } catch {
      return false;
    }
  },
  readFile: (p: string): string | undefined => {
    try {
      return readFn(p);
    } catch {
      return undefined;
    }
  },
});

/**
 * The `/// <reference types="X" />` (type) and `/// <reference path="Y" />` (path) directives in
 * `fileAbs`, via TypeScript's own `preProcessFile` — so attribute order, whitespace, BOM, and the
 * head-only validity rule match the compiler exactly (a hand regex misses `preserve="…" types=…`).
 * Missing/unreadable/garbage → empty.
 */
const extractReferenceDirectives = (
  readFn: (p: string) => string,
  fileAbs: string,
): { typeRefs: string[]; pathRefs: string[] } => {
  let text: string;

  try {
    text = readFn(fileAbs);
  } catch {
    return { typeRefs: [], pathRefs: [] };
  }

  try {
    const info = ts.preProcessFile(text, true, false);

    return {
      typeRefs: info.typeReferenceDirectives.map(r => r.fileName),
      pathRefs: info.referencedFiles.map(r => r.fileName),
    };
  } catch {
    return { typeRefs: [], pathRefs: [] };
  }
};

/** Collect every `.d.ts`/`.d.mts`/`.d.cts` path anywhere in a package.json `exports` subtree. */
const collectExportsDts = (node: unknown, out: Set<string>): void => {
  if (typeof node === 'string') {
    if (/\.d\.[mc]?ts$/.test(node)) {
      out.add(node);
    }

    return;
  }

  if (node === null || typeof node !== 'object') {
    return;
  }

  for (const value of Object.values(node as Record<string, unknown>)) {
    collectExportsDts(value, out);
  }
};

/**
 * Every candidate entry `.d.ts` relative path for a package: manifest `types`/`typings`, every
 * `.d.ts` reachable in `exports` (any condition nesting — `exports["."].import.types`, etc.), and
 * the default `index.d.ts`. Returning ALL candidates is widen-only: scanning an extra `.d.ts` for
 * reference directives can only add holds, so an over-broad set never causes a false W.
 */
const entryDtsRels = (manifest: { types?: unknown; typings?: unknown; exports?: unknown }): string[] => {
  const rels = new Set<string>();

  if (typeof manifest.types === 'string') {
    rels.add(manifest.types);
  }

  if (typeof manifest.typings === 'string') {
    rels.add(manifest.typings);
  }

  collectExportsDts(manifest.exports, rels);
  rels.add('index.d.ts');

  return [...rels];
};

/**
 * Resolve a package's candidate entry `.d.ts` absolute paths, walking `node_modules` depRoot→rootAbs.
 * Empty ONLY when no readable `package.json` is found in the walk (package not installed here).
 */
const resolveEntryDtsPaths = (depRoot: string, rootAbs: string, pkg: string, readFn: (p: string) => string): string[] => {
  let dir = depRoot;

  for (;;) {
    const pkgDir = path.join(dir, 'node_modules', pkg);

    try {
      return entryDtsRels(readPackageJson(pkgDir, readFn)).map(rel => path.join(pkgDir, rel));
    } catch {
      if (dir === rootAbs) {
        return [];
      }

      const parent = path.dirname(dir);

      dir = parent.length < rootAbs.length ? rootAbs : parent;
    }
  }
};

interface AmbientHolds {
  /** false → the ambient set is not closable at this root → HOLD every unimported dep (per "닫히지 않으면 보류"). */
  readonly closed: boolean;
  readonly holds: ReadonlySet<string>;
}

/** Bound on the `.d.ts` reference-chain BFS; tripping it returns `closed:false` (HOLD), never a partial closed set. */
const AMBIENT_CHAIN_MAX = 4096;

/**
 * Packages consumed AMBIENTLY (no `import`) at `depRoot`, so they are never mis-reported as
 * unused-dependency. Every source is a DECLARED fact, never a name guess:
 *   (b) tsconfig `compilerOptions.types` — extends-merged, jsonc-safe, subpath-resolved via the
 *       TypeScript compiler API, following `references` (which TS does NOT merge) and every
 *       root-level `tsconfig*.json` — plus the owner package root of each entry;
 *   (c1) `/// <reference types="X" />` in project sources;
 *   (c2) the same directive (and `reference path` hops) in the entry `.d.ts` of a held / `@types/*`
 *        package (the `@types/bun` → `bun-types` reference chain), bounded BFS over files.
 * The caller keeps the unconditional `@types/*` blanket hold (a) separately.
 * `closed` is false — the caller then holds every unimported dep at this root — when the ambient set
 * cannot be closed: an unreadable `extends` base, custom `typeRoots` with no explicit `types`, any
 * non-benign tsconfig diagnostic, or a reference chain exceeding the BFS bound. Never throws (any
 * failure → `{ closed:false }`, the FN direction — never a false W).
 */
const resolveAmbientTypeHolds = (
  depRoot: string,
  rootAbs: string,
  readFn: (p: string) => string,
  listDir: (dir: string) => ReadonlyArray<string>,
  projectFiles: ReadonlySet<string>,
  declaredDeps: ReadonlySet<string>,
): AmbientHolds => {
  const host = makeParseConfigHost(readFn);
  const holds = new Set<string>();
  const ingested = new Set<string>();

  const ingestTsconfig = (tsconfigPath: string): 'closed' | 'unclosable' | 'absent' => {
    if (ingested.has(tsconfigPath)) {
      return 'closed';
    }

    ingested.add(tsconfigPath);

    if (!host.fileExists(tsconfigPath)) {
      return 'absent';
    }

    const read = ts.readConfigFile(tsconfigPath, host.readFile);

    if (read.error !== undefined || read.config === undefined) {
      return 'unclosable';
    }

    const parsed = ts.parseJsonConfigFileContent(read.config, host, path.dirname(tsconfigPath));

    // Any diagnostic other than the benign 18003 ("no inputs", expected from the empty
    // readDirectory) means the config is not fully trustworthy — an unreadable/malformed/circular
    // `extends` (5083/6053/1005/18000, …) → we cannot prove the ambient set → unclosable.
    if (parsed.errors.some(e => e.code !== 18003)) {
      return 'unclosable';
    }

    // Custom typeRoots with no explicit `types` auto-includes every folder under those roots —
    // folder names unreachable through readFn → unclosable.
    if (parsed.options.typeRoots !== undefined && parsed.options.types === undefined) {
      return 'unclosable';
    }

    for (const entry of parsed.options.types ?? []) {
      ambientKeysFor(entry, holds);
    }

    // TS does not merge a referenced project's `types` into the referencing config — follow each.
    // A declared reference that we cannot read ('absent'/'unclosable') leaves the ambient set
    // unprovable → unclosable (per "닫히지 않으면 보류").
    for (const ref of parsed.projectReferences ?? []) {
      const refPath = ref.path.endsWith('.json') ? ref.path : path.join(ref.path, 'tsconfig.json');

      if (ingestTsconfig(refPath) !== 'closed') {
        return 'unclosable';
      }
    }

    return 'closed';
  };

  try {
    // Primary configs — authoritative for the scanned graph. Their extends/references chain is
    // followed; an unclosable primary → HOLD every unimported dep at this root.
    for (const primary of new Set([path.join(depRoot, 'tsconfig.json'), path.join(rootAbs, 'tsconfig.json')])) {
      if (ingestTsconfig(primary) === 'unclosable') {
        return { closed: false, holds };
      }
    }

    // Sibling root-level `tsconfig*.json` (tsconfig.build.json / tsconfig.node.json / …) are
    // ADDITIVE widen-only type sources: a clean sibling contributes its `types`; a broken one
    // contributes nothing (its `types` would not load in reality either) and does NOT force a
    // root-wide hold. listDir is fs-backed in prod; empty (mock/no-fs) → only the primaries run.
    for (const dir of new Set([depRoot, rootAbs])) {
      for (const name of listDir(dir)) {
        if (/^tsconfig.*\.json$/.test(name)) {
          ingestTsconfig(path.join(dir, name));
        }
      }
    }

    // (c1) project-source triple-slash type references.
    for (const fileAbs of projectFiles) {
      for (const ref of extractReferenceDirectives(readFn, fileAbs).typeRefs) {
        ambientKeysFor(ref, holds);
      }
    }

    // (c2) reference chain over the entry `.d.ts` of held / `@types/*` packages, following both
    // `reference types` (→ hold + that package's entry) and `reference path` (→ sibling file).
    // Bounded BFS over FILES; tripping the bound returns unclosable (never a partial closed set).
    const seenFiles = new Set<string>();
    const fileQueue: string[] = [];

    for (const held of holds) {
      fileQueue.push(...resolveEntryDtsPaths(depRoot, rootAbs, packageRoot(held), readFn));
    }

    // A declared @types package we cannot resolve at all (no readable manifest in the walk) may
    // carry a `/// <reference types>` chain we would then miss → hold-all rather than risk a false W.
    for (const typesPkg of [...declaredDeps].filter(d => d.startsWith('@types/'))) {
      const entries = resolveEntryDtsPaths(depRoot, rootAbs, typesPkg, readFn);

      if (entries.length === 0) {
        return { closed: false, holds };
      }

      fileQueue.push(...entries);
    }

    let guard = 0;

    while (fileQueue.length > 0) {
      if (guard++ >= AMBIENT_CHAIN_MAX) {
        return { closed: false, holds };
      }

      const file = fileQueue.shift()!;

      if (seenFiles.has(file)) {
        continue;
      }

      seenFiles.add(file);

      const { typeRefs, pathRefs } = extractReferenceDirectives(readFn, file);

      for (const ref of typeRefs) {
        ambientKeysFor(ref, holds);
        fileQueue.push(...resolveEntryDtsPaths(depRoot, rootAbs, packageRoot(ref), readFn));
      }

      for (const rel of pathRefs) {
        fileQueue.push(path.resolve(path.dirname(file), rel));
      }
    }

    return { closed: true, holds };
  } catch {
    return { closed: false, holds };
  }
};

/* ------------------------------------------------------------------ */
/*  Path helpers                                                       */
/* ------------------------------------------------------------------ */

const readPackageEntrypoints = (rootAbs: string, readFn: (p: string) => string): ReadonlyArray<string> => {
  try {
    const parsed = readPackageJson(rootAbs, readFn);
    const out: string[] = [];

    const collectStrings = (node: unknown): void => {
      if (typeof node === 'string') {
        out.push(node);

        return;
      }

      if (!node || typeof node !== 'object') {
        return;
      }

      if (Array.isArray(node)) {
        for (const entry of node) {
          collectStrings(entry);
        }

        return;
      }

      for (const value of Object.values(node as Record<string, unknown>)) {
        collectStrings(value);
      }
    };

    const scalarFields = ['main', 'module', 'browser', 'types', 'typings'] as const;

    for (const field of scalarFields) {
      if (typeof parsed[field] === 'string') {
        out.push(parsed[field] as string);
      }
    }

    collectStrings(parsed.bin);
    collectStrings(parsed.exports);

    return out;
  } catch {
    return [];
  }
};

const resolveEntrypointToFile = (rootAbs: string, spec: string, graphKeys: ReadonlySet<string>): string | null => {
  if (typeof spec !== 'string' || spec.trim().length === 0) {
    return null;
  }

  const trimmed = spec.trim();
  const rel = trimmed.startsWith('.') ? trimmed : `./${trimmed}`;
  const abs = path.resolve(rootAbs, rel);
  const candidates = [abs, `${abs}.ts`, path.join(abs, 'index.ts')];

  for (const candidate of candidates) {
    const normalized = normalizePath(candidate);

    if (graphKeys.has(normalized)) {
      return normalized;
    }
  }

  return null;
};

/* ------------------------------------------------------------------ */
/*  Edge cut hints                                                     */
/* ------------------------------------------------------------------ */

/**
 * Value-only file→file adjacency from `imports` relations. gildash records `import type` as a
 * `type-references` relation (never `imports`), so this graph excludes runtime-erased type-only
 * edges by construction — a cycle here is a real runtime import cycle. Self-imports (a file
 * importing itself) are dropped: "두 파일 이상" (a same-file loop is a type/runtime bug, not a
 * circular-dependency). Neighbours are sorted for deterministic downstream traversal.
 */
const buildValueAdjacency = (
  rootAbs: string,
  importRels: ReadonlyArray<{
    readonly srcFilePath: string | null;
    readonly dstFilePath: string | null;
    readonly isExternal: boolean;
  }>,
): Map<string, ReadonlyArray<string>> => {
  const sets = new Map<string, Set<string>>();

  const ensure = (node: string): Set<string> => {
    let set = sets.get(node);

    if (set === undefined) {
      set = new Set<string>();

      sets.set(node, set);
    }

    return set;
  };

  for (const rel of importRels) {
    if (rel.isExternal !== false || rel.srcFilePath === null || rel.dstFilePath === null) {
      continue;
    }

    const from = resolveAbs(rootAbs, rel.srcFilePath);
    const to = resolveAbs(rootAbs, rel.dstFilePath);

    if (from === to) {
      continue;
    }

    ensure(from).add(to);
    ensure(to);
  }

  const adj = new Map<string, ReadonlyArray<string>>();

  for (const [node, targets] of sets) {
    adj.set(node, [...targets].sort());
  }

  return adj;
};

/**
 * Strongly-connected components via iterative Tarjan (iterative to avoid stack overflow on deep
 * graphs). Deterministic: nodes and neighbours are iterated in sorted order, so SCC membership and
 * discovery order are corpus-independent for a fixed graph.
 */
const tarjanSCCs = (adj: Map<string, ReadonlyArray<string>>): string[][] => {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const component: string[] = [];
  const sccs: string[][] = [];
  let counter = 0;

  for (const root of [...adj.keys()].sort()) {
    if (index.has(root)) {
      continue;
    }

    const frames: Array<{ node: string; next: number }> = [{ node: root, next: 0 }];

    while (frames.length > 0) {
      const frame = frames[frames.length - 1]!;
      const v = frame.node;

      if (frame.next === 0) {
        index.set(v, counter);
        low.set(v, counter);

        counter += 1;

        component.push(v);
        onStack.add(v);
      }

      const neighbours = adj.get(v) ?? [];

      if (frame.next < neighbours.length) {
        const w = neighbours[frame.next]!;

        frame.next += 1;

        if (!index.has(w)) {
          frames.push({ node: w, next: 0 });
        } else if (onStack.has(w)) {
          low.set(v, Math.min(low.get(v)!, index.get(w)!));
        }

        continue;
      }

      // v is finished — close its SCC if it is a root, then fold its low-link into the parent.
      if (low.get(v) === index.get(v)) {
        const scc: string[] = [];

        for (;;) {
          const w = component.pop()!;

          onStack.delete(w);
          scc.push(w);

          if (w === v) {
            break;
          }
        }

        sccs.push(scc);
      }

      frames.pop();

      const parent = frames[frames.length - 1];

      if (parent !== undefined) {
        low.set(parent.node, Math.min(low.get(parent.node)!, low.get(v)!));
      }
    }
  }

  return sccs;
};

/**
 * One representative simple cycle within a strongly-connected component, as an edge-following path
 * (`p[i] → p[i+1]`, and `p[last] → p[0]`). Greedily follows the smallest in-SCC neighbour from the
 * smallest node until a node repeats — deterministic and O(path) (no recursion). Every node in an
 * SCC lies on some cycle, so this always terminates on a real cycle.
 */
const representativeCycle = (scc: ReadonlyArray<string>, adj: Map<string, ReadonlyArray<string>>): string[] => {
  const inScc = new Set(scc);
  const position = new Map<string, number>();
  const path: string[] = [];
  let node = [...scc].sort()[0]!;

  for (;;) {
    const at = position.get(node);

    if (at !== undefined) {
      return path.slice(at);
    }

    position.set(node, path.length);
    path.push(node);

    const next = (adj.get(node) ?? []).find(w => inScc.has(w));

    if (next === undefined) {
      return [...scc]; // unreachable for a real SCC (size ≥ 2); defensive
    }

    node = next;
  }
};

const buildEdgeCutHints = (
  rootAbs: string,
  cycles: ReadonlyArray<ReadonlyArray<string>>,
  outDegree: Map<string, number>,
): ReadonlyArray<DependencyEdgeCutHint> => {
  const seen = new Set<string>();
  const hints: DependencyEdgeCutHint[] = [];

  for (const cycle of cycles) {
    if (cycle.length < 2) {
      continue;
    }

    let bestIndex = 0;
    let bestScore = -1;

    for (let index = 0; index < cycle.length - 1; index += 1) {
      const from = cycle[index] ?? '';
      const score = outDegree.get(from) ?? 0;

      if (score <= bestScore) {
        continue;
      }

      bestScore = score;
      bestIndex = index;
    }

    const from = cycle[bestIndex] ?? '';
    const to = cycle[bestIndex + 1] ?? '';
    const key = `${from}=>${to}`;

    if (from.length === 0 || to.length === 0 || seen.has(key)) {
      continue;
    }

    seen.add(key);
    hints.push({
      from: toRelativePath(rootAbs, from),
      to: toRelativePath(rootAbs, to),
      score: bestScore > 0 ? bestScore : 1,
    });
  }

  return hints;
};

/* ------------------------------------------------------------------ */
/*  Main analysis function                                             */
/* ------------------------------------------------------------------ */

interface ExportEntry {
  name: string;
  kind: string;
  detail: SymbolDetail;
  /** The symbol's source location (from the gildash symbol index). */
  span: SourceSpan;
}

/** A default export: local name + `detail.isDefault` (gildash 0.40). Consumers reference it via the `default` slot. */
const isDefaultExport = (entry: { readonly detail: SymbolDetail }): boolean =>
  (entry.detail as { isDefault?: boolean } | undefined)?.isDefault === true;

const hasConsumers = (consumers: ReadonlySet<string> | undefined): boolean => consumers !== undefined && consumers.size > 0;

type Relation = ReturnType<Gildash['searchRelations']>[number];

/**
 * Collect re-export entries from `rels` into `exportsByFile`: for each relation
 * passing `shouldInclude` (and carrying a src symbol/file), add a re-export entry
 * keyed by its absolute file, skipping names already recorded for that file.
 * Single change-point for the two re-export collection passes (re-exports + type re-exports).
 */
const collectReExportEntries = (
  exportsByFile: Map<string, ExportEntry[]>,
  rootAbs: string,
  rels: ReadonlyArray<Relation>,
  shouldInclude?: (rel: Relation) => boolean,
): void => {
  for (const rel of rels) {
    if ((shouldInclude !== undefined && !shouldInclude(rel)) || !rel.srcSymbolName || !rel.srcFilePath) {
      continue;
    }

    const absFilePath = resolveAbs(rootAbs, rel.srcFilePath);
    const existing = exportsByFile.get(absFilePath) ?? [];

    if (existing.some(s => s.name === rel.srcSymbolName)) {
      continue;
    }

    existing.push({
      name: rel.srcSymbolName,
      kind: 're-export',
      detail: {} as SymbolDetail,
      // Re-export surfaces come from relations, which carry no source location
      // (gildash CodeRelation has no span) — zero span is the honest value here.
      span: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } },
    });
    exportsByFile.set(absFilePath, existing);
  }
};

const analyzeDependencies = async (gildash: Gildash, input?: AnalyzeDependenciesInput): Promise<DependencyAnalysis> => {
  const empty = createEmptyDependencies();
  const rootAbs = input?.rootAbs ?? process.cwd();
  const layerMatchers = input?.layers ? compileLayerMatchers(input.layers) : [];
  const readFn =
    input?.readFileFn ??
    ((p: string): string => {
      // No fs access provided — behave like a missing file (real-FS semantics),
      // NOT like an empty manifest: '{}' would make EVERY directory parse as a
      // package boundary and hold all dead-export verdicts.
      throw new Error(`ENOENT (no readFileFn): ${p}`);
    });
  // Directory lister for enumerating root-level `tsconfig*.json` (ambient-type resolution).
  // Omitted (unit tests) → no extra configs beyond the explicit `tsconfig.json` (widen-only).
  const listDir = input?.listDirFn ?? ((): ReadonlyArray<string> => []);
  // 1. Import graph
  let graph: Map<string, string[]>;

  try {
    graph = await gildash.getImportGraph();
  } catch (e) {
    if (!(e instanceof GildashError)) {
      throw e;
    }

    return empty;
  }

  // rootAbs에 고정한 경로 변환 — 같은 부분적용이 여러 map에 흩어지지 않도록 한곳에 둔다.
  const toAbs = (value: string) => resolveAbs(rootAbs, value);

  const toRel = (value: string) => toRelativePath(rootAbs, value);

  // Normalise gildash paths (may be project-relative) to absolute
  const absGraph = new Map<string, string[]>();

  for (const [from, targets] of graph) {
    absGraph.set(resolveAbs(rootAbs, from), targets.map(toAbs));
  }

  // 2. Adjacency & out-degree (out-degree drives circular-dependency edge-cut hints)
  const adjacencyOut: Record<string, ReadonlyArray<string>> = {};
  const outDegree = new Map<string, number>();

  for (const [from, targets] of absGraph.entries()) {
    // Dedupe edges: multiple import declarations to the same target count as one edge.
    const uniqueTargets = Array.from(new Set(targets));

    adjacencyOut[toRelativePath(rootAbs, from)] = uniqueTargets.map(toRel);

    outDegree.set(from, uniqueTargets.length);
  }

  // 3. Cycles — computed on the VALUE-only dependency graph (`imports` ∪ value `re-exports`), not
  // gildash's `getImportGraph`/`getCyclePaths`. Those merge runtime-erased `import type` edges (a
  // pure-type cycle is not a runtime cycle) and enumerate every elementary circuit (N per SCC → one
  // component reported N times). gildash records both `imports` and `re-exports` as VALUE relations
  // (type-only `import type`/`export type … from` are excluded from both), so a `export * from`/
  // `export { x } from` edge that closes a runtime cycle is included. Build the value adjacency, find
  // strongly-connected components (own iterative Tarjan), and report ONE cycle per non-trivial SCC.
  let cycleRelations: ReturnType<Gildash['searchRelations']> = [];

  try {
    cycleRelations = [...gildash.searchRelations({ type: 'imports' }), ...gildash.searchRelations({ type: 're-exports' })];
  } catch (e) {
    if (!(e instanceof GildashError)) {
      throw e;
    }
  }

  const valueAdjacency = buildValueAdjacency(rootAbs, cycleRelations);
  const cyclePaths = tarjanSCCs(valueAdjacency)
    .filter(scc => scc.length >= 2)
    .map(scc => representativeCycle(scc, valueAdjacency))
    .sort((left, right) => left.join('\n').localeCompare(right.join('\n')));
  const cycles = cyclePaths.map(p => ({ path: p.map(toRel) }));
  const cuts = buildEdgeCutHints(rootAbs, cyclePaths, outDegree);
  // 4. Layer violations
  const layerViolations: DependencyLayerViolation[] = [];

  if (layerMatchers.length > 0) {
    const allowedDependencies = input?.allowedDependencies ?? {};

    for (const [from, targets] of absGraph.entries()) {
      const fromLayer = matchLayerName(rootAbs, from, layerMatchers);

      if (!fromLayer) {
        continue;
      }

      const allowed = allowedDependencies[fromLayer] ?? [];

      for (const target of targets) {
        const toLayer = matchLayerName(rootAbs, target, layerMatchers);

        if (!toLayer || fromLayer === toLayer || allowed.includes(toLayer)) {
          continue;
        }

        layerViolations.push({
          kind: 'layer-violation',
          message: `${fromLayer} → ${toLayer} dependency not permitted`,
          from: toRelativePath(rootAbs, from),
          to: toRelativePath(rootAbs, target),
          fromLayer,
          toLayer,
        });
      }
    }
  }

  // 5. Collect exported symbols via searchSymbols (feeds duplicate-export detection below)
  const exportsByFile = new Map<string, ExportEntry[]>();

  try {
    const allExported = gildash.searchSymbols({ isExported: true });

    for (const sym of allExported) {
      const absFilePath = resolveAbs(rootAbs, sym.filePath);

      pushToMultiMap(exportsByFile, absFilePath, { name: sym.name, kind: sym.kind, detail: sym.detail, span: sym.span });
    }

    // Also collect re-exported symbols (not in searchSymbols({ isExported: true }))
    collectReExportEntries(exportsByFile, rootAbs, gildash.searchRelations({ type: 're-exports' }));

    // `export type { X } from './mod'` → type-references with meta.isReExport: true
    collectReExportEntries(
      exportsByFile,
      rootAbs,
      gildash.searchRelations({ type: 'type-references' }),
      rel => rel.meta?.isReExport === true,
    );
  } catch (e) {
    if (!(e instanceof GildashError)) {
      throw e;
    }
  }

  // 6. Duplicate export detection (same origin via resolveSymbol)
  const duplicateExports: DependencyDuplicateExportFinding[] = [];

  if (exportsByFile.size > 0) {
    // Group exports by name across all files
    const nameToEntries = new Map<string, Array<{ relModule: string; absModule: string; span: SourceSpan }>>();

    for (const [moduleAbs, symbols] of exportsByFile) {
      for (const sym of symbols) {
        // Skip re-exports for duplicate detection — they're not independent definitions
        if (sym.kind === 're-export') {
          continue;
        }

        pushToMultiMap(nameToEntries, sym.name, {
          relModule: toRelativePath(rootAbs, moduleAbs),
          absModule: moduleAbs,
          span: sym.span,
        });
      }
    }

    for (const [name, entries] of nameToEntries) {
      if (entries.length < 2) {
        continue;
      }

      // Use resolveSymbol to group by original source
      const originToModules = new Map<string, Array<{ module: string; span: SourceSpan }>>();

      for (const entry of entries) {
        let originKey: string;

        try {
          const resolved = gildash.resolveSymbol(name, toRelativePath(rootAbs, entry.absModule));

          originKey = `${resolved.originalFilePath}::${resolved.originalName}`;
        } catch {
          // resolveSymbol failed — use the module itself as origin
          originKey = `${entry.relModule}::${name}`;
        }

        pushToMultiMap(originToModules, originKey, { module: entry.relModule, span: entry.span });
      }

      for (const [, surfaces] of originToModules) {
        // A "surface" is a module: overload signatures (or any repeated declarations)
        // within ONE file are a single surface, not duplication — dedupe by module
        // and require 2+ DISTINCT modules (spec: "2개 이상의 표면에 중복 노출").
        const distinctModules = [...new Set(surfaces.map(sf => sf.module))];

        if (distinctModules.length > 1) {
          const first = surfaces.find(sf => sf.module === distinctModules[0]);

          duplicateExports.push({
            kind: 'duplicate-export',
            name,
            modules: distinctModules,
            span: first?.span ?? { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } },
          });
        }
      }
    }
  }

  // 7. Dead export + unused file + unused dep + unresolved import + unused member detection
  const deadExports: DependencyDeadExportFinding[] = [];
  const unusedFiles: DependencyUnusedFileFinding[] = [];
  const unusedDeps: DependencyUnusedDepFinding[] = [];
  const unresolvedImports: DependencyUnresolvedImportFinding[] = [];
  const unusedMembers: DependencyUnusedMemberFinding[] = [];

  {
    let imports: ReturnType<Gildash['searchRelations']> = [];
    let reExports: ReturnType<Gildash['searchRelations']> = [];
    let typeRefs: ReturnType<Gildash['searchRelations']> = [];
    let calls: ReturnType<Gildash['searchRelations']> = [];
    let hasImportData = false;
    // Relation-completeness gates (spec: 전체-인덱싱 전제). dead-export·member
    // judgments require imports + re-exports + type-references + calls to all
    // index successfully; if any relation query degrades (GildashError), those
    // "usage = 0" verdicts are held (보류) to avoid FPs from missing edges.
    let hasReExportData = false;
    let hasTypeRefData = false;
    let hasCallData = false;

    try {
      imports = gildash.searchRelations({ type: 'imports' });
      hasImportData = true;
    } catch (e) {
      if (!(e instanceof GildashError)) {
        throw e;
      }
    }

    try {
      reExports = gildash.searchRelations({ type: 're-exports' });
      hasReExportData = true;
    } catch (e) {
      if (!(e instanceof GildashError)) {
        throw e;
      }
    }

    try {
      typeRefs = gildash.searchRelations({ type: 'type-references' });
      hasTypeRefData = true;
    } catch (e) {
      if (!(e instanceof GildashError)) {
        throw e;
      }
    }

    try {
      calls = gildash.searchRelations({ type: 'calls' });
      hasCallData = true;
    } catch (e) {
      if (!(e instanceof GildashError)) {
        throw e;
      }
    }

    // dead-export / unused-enum|ns-member are only sound when
    // the full relation index is available. Missing any relation → hold verdicts.
    const relationsComplete = hasReExportData && hasTypeRefData && hasCallData;

    if (hasImportData) {
      // Build usage map per module
      interface ModuleUsage {
        usesAll: boolean;
        /** symbol name → set of external consumer file paths (self-references excluded) */
        names: Map<string, Set<string>>;
      }

      const usageByModule = new Map<string, ModuleUsage>();

      for (const rel of [...imports, ...reExports, ...typeRefs, ...calls]) {
        if (rel.dstFilePath === null) {
          continue;
        }

        const target = resolveAbs(rootAbs, rel.dstFilePath);
        const consumer = resolveAbs(rootAbs, rel.srcFilePath);

        // Self-reference (same file calls/references itself) — not external usage
        if (target === consumer) {
          continue;
        }

        const state = usageByModule.get(target) ?? {
          usesAll: false,
          names: new Map<string, Set<string>>(),
        };
        // '*' = namespace import (import * as X). re-export with null dstSymbolName = export * from './mod'.
        // Dynamic `import('./mod')` receives the WHOLE module-namespace object at runtime —
        // whole consumption, same as `import *`; gildash marks it as a closed fact via
        // meta.isDynamic (a side-effect import has no meta and stays non-consuming).
        // Other null dstSymbolName forms (side-effect import, CJS require) — skip.
        const isDynamicImport = (rel.meta as { isDynamic?: boolean } | undefined)?.isDynamic === true;

        if (rel.dstSymbolName === '*' || (rel.type === 're-exports' && !rel.dstSymbolName) || isDynamicImport) {
          state.usesAll = true;
        } else if (rel.dstSymbolName) {
          addToSetMap(state.names, rel.dstSymbolName, consumer);
        }
        // else: null/undefined dstSymbolName on non-re-export → side-effect import, skip

        usageByModule.set(target, state);
      }

      // Entry point reachability via BFS
      // Entry points: package.json fields + test/config/script files in graph.
      // Monorepos: every nested package manifest is a package boundary whose
      // entrypoints are consumed by EXTERNAL package consumers — a sub-package's
      // entry file is not "unused" just because the root manifest doesn't point
      // at it. Collect manifests from every ancestor dir of graph files.
      const graphKeys = new Set(absGraph.keys());
      const entryModules = new Set<string>();
      const manifestDirs = new Set<string>([rootAbs]);

      for (const fileAbs of graphKeys) {
        let dir = path.dirname(fileAbs);

        while (dir.startsWith(rootAbs) && dir.length >= rootAbs.length) {
          manifestDirs.add(dir);

          const parent = path.dirname(dir);

          if (parent === dir) {
            break;
          }

          dir = parent;
        }
      }

      const nestedPkgDirs: string[] = [];
      // Track the ROOT package's declared entrypoints vs how many resolve into the TS graph. Only
      // the root package's modules reach the per-symbol dead-export gate below (nested-package files
      // are held wholesale by `isUnderNestedPackage`), so the "public surface unresolved" signal must
      // be scoped to the root package alone — aggregating across nested manifests would let a
      // resolvable sub-package disable the hold for a dist-pointing root (false W), or a dist-pointing
      // sub-package suppress a genuinely-analyzable root (FN).
      let rootDeclaredEntrypointCount = 0;
      let rootResolvedEntrypointCount = 0;

      for (const dir of manifestDirs) {
        // Package boundary = a parseable manifest EXISTS — apps (Next 등) often have
        // no main/exports fields but are still externally-driven package roots.
        try {
          readPackageJson(dir, readFn);
        } catch {
          continue;
        }

        if (dir !== rootAbs) {
          nestedPkgDirs.push(`${dir}/`);
        }

        for (const spec of readPackageEntrypoints(dir, readFn)) {
          if (dir === rootAbs) {
            rootDeclaredEntrypointCount += 1;
          }

          const resolved = resolveEntrypointToFile(dir, spec, graphKeys);

          if (resolved) {
            entryModules.add(resolved);

            if (dir === rootAbs) {
              rootResolvedEntrypointCount += 1;
            }
          }
        }
      }

      // Files under a NESTED package boundary are consumed by external package
      // consumers (outside the indexed graph) — unused-file cannot be proven for
      // them from this graph, so the verdict is held (spec: 전체-인덱싱 전제).
      const isUnderNestedPackage = (fileAbs: string): boolean => nestedPkgDirs.some(d => fileAbs.startsWith(d));

      // Reachability roots come ONLY from declared facts: package.json entrypoints (above) and
      // user-declared `entry` globs. No filename-convention inference (that is a guess-value).
      const userEntryGlobs = input?.entry ?? [];
      const entryMatchers = userEntryGlobs.map(globToRegExp);
      // The ROOT package declares a public entry surface but NONE of it resolves into the graph
      // (dist-pointing manifest) and the user did not pin a source `entry`. The public API is then
      // unidentifiable — its real consumers are external — so no root export can be proven dead. Hold
      // every dead-export (FN, per "닫히지 않으면 보류"); the user opts back in via an `entry` glob.
      const publicSurfaceUnresolved =
        rootDeclaredEntrypointCount > 0 && rootResolvedEntrypointCount === 0 && userEntryGlobs.length === 0;

      if (entryMatchers.length > 0) {
        // Match against BOTH the import-graph keys and the symbol index: a tool-loaded
        // config (drizzle.config.ts) that nobody imports has no graph node, but its
        // exports exist in the symbol index and its entry declaration must still land.
        const entryCandidates = new Set<string>([...graphKeys, ...exportsByFile.keys()]);

        for (const fileAbs of entryCandidates) {
          if (entryMatchers.some(re => re.test(toRel(fileAbs)))) {
            entryModules.add(fileAbs);
          }
        }
      }

      // User-declared `ignore` globs (root-relative) — files excluded from unused-file reporting.
      const ignoreMatchers = (input?.ignore ?? []).map(globToRegExp);
      const reachable = new Set<string>();
      const queue: string[] = [];

      const enqueueReachable = (moduleAbs: string): void => {
        reachable.add(moduleAbs);
        queue.push(moduleAbs);
      };

      for (const entry of entryModules) {
        enqueueReachable(entry);
      }

      while (queue.length > 0) {
        const current = queue.shift()!;

        for (const next of absGraph.get(current) ?? []) {
          if (!reachable.has(next)) {
            enqueueReachable(next);
          }
        }
      }

      // unused-file is OPT-IN: emit only when the user declared `entry` — their assertion that
      // the entry set is complete. Without it, completeness is unproven (a test/config file
      // unreachable from package.json is not necessarily dead) → HOLD (FN direction, never a
      // false-positive flood). package.json entrypoints still seed reachability above.
      const unreachableModules = new Set<string>();
      const userDeclaredEntry = userEntryGlobs.length > 0;

      // Populate `unreachableModules` whenever reachability is computable (entry roots exist) so
      // the dead-export pass below can dedup (a file-level orphan must not also surface as
      // per-symbol dead-export). But EMIT `unused-file` only when the user opted in via `entry`
      // (their assertion the entry set is complete) — otherwise HOLD (FN, never a false flood).
      if (entryModules.size > 0) {
        for (const moduleAbs of graphKeys) {
          if (
            !reachable.has(moduleAbs) &&
            !isUnderNestedPackage(moduleAbs) &&
            !ignoreMatchers.some(re => re.test(toRel(moduleAbs)))
          ) {
            unreachableModules.add(moduleAbs);

            if (userDeclaredEntry) {
              unusedFiles.push({
                kind: 'unused-file',
                module: toRelativePath(rootAbs, moduleAbs),
              });
            }
          }
        }
      }

      // Check each module's exports (skip unreachable — already reported as unused file).
      // Held entirely when the relation index is incomplete (spec: 전체-인덱싱 전제).
      for (const [moduleAbs, symbols] of relationsComplete ? exportsByFile : []) {
        // Nested-package files: their symbol consumers are external package
        // consumers (outside the indexed graph) — hold dead-export verdicts.
        if (
          publicSurfaceUnresolved ||
          symbols.length === 0 ||
          unreachableModules.has(moduleAbs) ||
          isUnderNestedPackage(moduleAbs)
        ) {
          continue;
        }

        // Entry modules (package.json entrypoints ∪ user-declared entry globs): their
        // exports are consumed OUTSIDE the graph by definition (a runner, a tool loading
        // the file by string, an external package) — an external contract, never dead.
        if (entryModules.has(moduleAbs)) {
          continue;
        }

        const usage = usageByModule.get(moduleAbs);

        if (usage?.usesAll) {
          continue;
        }

        const usedNames = usage?.names ?? new Map<string, Set<string>>();

        for (const sym of symbols) {
          const relModule = toRelativePath(rootAbs, moduleAbs);

          // Has at least one consumer (test, prod, or otherwise) → not dead. Whether a consumer
          // "counts" as production use is not decidable from a filename fact, so no test-only
          // refinement (would require a guess-value). A DEFAULT export's local name is not how it is
          // consumed — `import x from './m'` records the edge under the `default` slot, while the
          // export symbol carries its local name plus `detail.isDefault` (gildash 0.40). So a default
          // export is live if the `default` slot has a consumer (or its local name, for the
          // `export { x }; export { x as default }` dual-export case).
          if (isDefaultExport(sym) && hasConsumers(usedNames.get('default'))) {
            continue;
          }

          if (hasConsumers(usedNames.get(sym.name))) {
            continue;
          }

          deadExports.push({
            kind: 'dead-export',
            module: relModule,
            name: sym.name,
            symbolKind: sym.kind,
            span: sym.span,
          });
        }
      }

      // 2nd pass: propagate dead re-exports upward.
      // If an export's only consumers are files whose re-export of the same symbol is dead,
      // then the original export is also dead.
      const deadSet = new Set(deadExports.map(d => `${resolveAbs(rootAbs, d.module)}::${d.name}`));
      let changed = relationsComplete;

      while (changed) {
        changed = false;

        for (const [moduleAbs, symbols] of exportsByFile) {
          if (unreachableModules.has(moduleAbs) || entryModules.has(moduleAbs)) {
            continue;
          }

          const usage = usageByModule.get(moduleAbs);

          if (usage?.usesAll) {
            continue;
          }

          const usedNames = usage?.names ?? new Map<string, Set<string>>();

          for (const sym of symbols) {
            const key = `${moduleAbs}::${sym.name}`;

            if (deadSet.has(key)) {
              continue;
            }

            // A default export live via its `default` slot must not be propagated dead through its
            // NAMED-slot consumers. For a dual `export { x }; export { x as default }`, `usedNames`
            // keys the default consumer under `default` and the named consumer under `x`; if the
            // named consumers are all dead re-exporters but the default slot is live, `x` is still
            // live (grok review — else a live default false-W's here).
            if (isDefaultExport(sym) && hasConsumers(usedNames.get('default'))) {
              continue;
            }

            const consumers = usedNames.get(sym.name);

            if (!consumers || consumers.size === 0) {
              continue;
            }

            // Check if ALL consumers are dead re-exporters of this symbol
            const allConsumersDead = [...consumers].every(consumerAbs => {
              const consumerExports = exportsByFile.get(consumerAbs);
              const isReExporter = consumerExports?.some(s => s.name === sym.name && s.kind === 're-export');

              return isReExporter === true && deadSet.has(`${consumerAbs}::${sym.name}`);
            });

            if (allConsumersDead) {
              deadSet.add(key);
              deadExports.push({
                kind: 'dead-export',
                module: toRelativePath(rootAbs, moduleAbs),
                name: sym.name,
                symbolKind: sym.kind,
                span: sym.span,
              });

              changed = true;
            }
          }
        }
      }

      // Named-import attribution index: consumerFileAbs → importedName → set of
      // source module abs it was imported from. Lets a cross-file qualified call
      // (`Guards.isNumber()` recorded on the consumer file) be attributed back to
      // the parent's defining module via the consumer's `import { Guards }`.
      const importedNameFrom = new Map<string, Map<string, Set<string>>>();

      for (const rel of imports) {
        if (rel.dstFilePath === null || !rel.dstSymbolName || rel.dstSymbolName === '*') {
          continue;
        }

        const consumerAbs = resolveAbs(rootAbs, rel.srcFilePath);
        const targetAbs = resolveAbs(rootAbs, rel.dstFilePath);
        const byName = importedNameFrom.get(consumerAbs) ?? new Map<string, Set<string>>();

        addToSetMap(byName, rel.dstSymbolName, targetAbs);
        importedNameFrom.set(consumerAbs, byName);
      }

      // Unused enum/namespace members: getSymbolsByFile returns members with memberName.
      // A member is unused if its parent is exported but the member is never referenced
      // in calls relations (e.g. Color.Red, Guards.isString).
      for (const [moduleAbs, symbols] of relationsComplete ? exportsByFile : []) {
        const memberParents = symbols.filter(s => s.kind === 'enum' || s.kind === 'namespace');

        // Hold for nested-package files AND for a dist-pointing root whose public surface is
        // unresolvable — an exported enum/namespace is then public API whose members may be used by
        // unindexed external consumers, so an internally-uncalled member cannot be proven unused
        // (holistic review: #9 held dead-export but not members, leaving `Color.Green` false-W'able
        // while `Color` is a public export).
        if (publicSurfaceUnresolved || memberParents.length === 0 || isUnderNestedPackage(moduleAbs)) {
          continue;
        }

        const relModule = toRelativePath(rootAbs, moduleAbs);
        // Get all symbols in this file (including non-exported members)
        let fileSymbols: ReturnType<Gildash['getSymbolsByFile']>;

        try {
          fileSymbols = gildash.getSymbolsByFile(relModule);
        } catch {
          continue;
        }

        for (const parent of memberParents) {
          // Find members: memberName != null, name starts with ParentName.
          // Type-only members (`type`/`interface` inside a namespace) are consumed via
          // type-references, never via calls — the call-oracle cannot observe their use, so they
          // can never be proven unused. Exclude them from candidacy (hold, FN direction) rather
          // than flag every type member as dead.
          const members = fileSymbols.filter(
            s => s.memberName !== null && s.name.startsWith(parent.name + '.') && s.kind !== 'type' && s.kind !== 'interface',
          );
          const prefix = parent.name + '.';
          // Collect every qualified call to `Parent.member`, attributing it to this
          // parent module. A call is attributed when either (a) it is recorded on
          // the parent module itself (in-file qualified call), or (b) it is recorded
          // on a consumer file that named-imported `Parent` from this module.
          const attributedCalls: string[] = [];
          let attributionUnresolved = false;

          for (const r of calls) {
            if (r.dstFilePath === null || r.dstSymbolName === null || !r.dstSymbolName.startsWith(prefix)) {
              continue;
            }

            const callFileAbs = resolveAbs(rootAbs, r.dstFilePath);

            if (callFileAbs === moduleAbs) {
              attributedCalls.push(r.dstSymbolName);

              continue;
            }

            const importsHere = importedNameFrom.get(callFileAbs)?.get(parent.name);

            if (importsHere?.has(moduleAbs) === true) {
              attributedCalls.push(r.dstSymbolName);
            } else {
              // A qualified call to this parent name that cannot be attributed to
              // this module — attribution not closed, so hold the whole parent's
              // member verdict (conservative K) to avoid flagging used members.
              attributionUnresolved = true;
            }
          }

          // If attribution is not closed, hold this parent's judgment.
          if (attributionUnresolved) {
            continue;
          }

          // If no calls at all, skip — can't determine member usage without semantic
          if (attributedCalls.length === 0) {
            continue;
          }

          const usedMembers = new Set(attributedCalls);
          // usesAll → skip
          const moduleUsage = usageByModule.get(moduleAbs);

          if (moduleUsage?.usesAll) {
            continue;
          }

          for (const member of members) {
            if (!usedMembers.has(`${parent.name}.${member.memberName}`)) {
              const findingKind: DependencyUnusedMemberFinding['kind'] =
                parent.kind === 'enum' ? 'unused-enum-member' : 'unused-ns-member';

              unusedMembers.push({
                kind: findingKind,
                module: relModule,
                symbolName: parent.name,
                memberName: member.memberName!,
                span: member.span,
              });
            }
          }
        }
      }

      // Phase 2: unused/unlisted dependencies + unresolved imports
      const externalPackages = new Map<string, Set<string>>();

      // A relative specifier whose target exists on disk but is not in the TS graph is outside the
      // index (a `.json`/`.css`/other non-TS asset gildash did not index), not a broken reference.
      // Per the whole-indexing premise, hold (FN) instead of reporting unresolved-import.
      const relativeTargetExists = (rel: Relation): boolean => {
        const spec = rel.specifier;

        if (typeof spec !== 'string' || !spec.startsWith('.')) {
          return false;
        }

        try {
          readFn(path.resolve(path.dirname(resolveAbs(rootAbs, rel.srcFilePath)), spec));

          return true;
        } catch {
          return false;
        }
      };

      for (const rel of imports) {
        // gildash 0.28 contract: `specifier` is always present on 'imports' relations.
        // Unresolved internal import
        if (rel.isExternal === false && rel.dstFilePath === null) {
          if (!relativeTargetExists(rel)) {
            unresolvedImports.push({
              kind: 'unresolved-import',
              module: toRel(resolveAbs(rootAbs, rel.srcFilePath)),
              specifier: rel.specifier!,
            });
          }

          continue;
        }

        // External package import. Bare builtin names (`buffer`, `path`) ARE collected (a declared
        // one is a polyfill fact → must count as used); only prefixed builtins are never packages.
        if (rel.isExternal === true && typeof rel.specifier === 'string') {
          const pkgName = extractPackageName(rel.specifier);

          if (pkgName && !isPrefixedBuiltin(pkgName)) {
            addToSetMap(externalPackages, pkgName, toRel(resolveAbs(rootAbs, rel.srcFilePath)));
          }
        }
      }

      // #5: `import type { … } from 'pkg'` is a real consumption of `pkg` (gildash records it as a
      // `type-references` relation, not `imports`). It feeds used-SUPPRESSION only — NOT unlisted:
      // a type-only import's contract is also satisfied by `@types/pkg` (which the unlisted check
      // does not back-map), so folding it into the unlisted-candidate set would false-W a package
      // that is declared only under `@types/*`. Kept separate for that reason.
      const typeOnlyExternal = new Map<string, Set<string>>();

      for (const rel of typeRefs) {
        if (rel.isExternal === true && typeof rel.specifier === 'string') {
          const pkgName = extractPackageName(rel.specifier);

          if (pkgName && !isPrefixedBuiltin(pkgName)) {
            addToSetMap(typeOnlyExternal, pkgName, toRel(resolveAbs(rootAbs, rel.srcFilePath)));
          }
        }
      }

      // Unresolved re-export: `export … from './missing'` is the same "internal
      // reference not resolving to a file" concept as an unresolved import
      // (dstFilePath === null on a non-external re-export with a module specifier).
      const seenUnresolved = new Set(unresolvedImports.map(u => `${u.module}::${u.specifier}`));

      for (const rel of reExports) {
        if (rel.isExternal === true || rel.dstFilePath !== null || !rel.specifier || !rel.srcFilePath) {
          continue;
        }

        // Same on-disk-existence hold as imports: `export … from './asset.json'` whose target exists
        // is outside the TS index, not a broken reference → hold.
        if (relativeTargetExists(rel)) {
          continue;
        }

        const module = toRel(resolveAbs(rootAbs, rel.srcFilePath));
        const key = `${module}::${rel.specifier}`;

        if (seenUnresolved.has(key)) {
          continue;
        }

        seenUnresolved.add(key);
        unresolvedImports.push({ kind: 'unresolved-import', module, specifier: rel.specifier });
      }

      // Compare with package.json dependencies (per workspace or root)
      const ignorePats = (input?.ignoreDependencies ?? []).map(pat => globToRegExp(pat));

      const shouldIgnore = (name: string): boolean => ignorePats.some(re => re.test(name));

      const checkDeps = (
        depRoot: string,
        usedPackages: Map<string, Set<string>>,
        typeUsed: ReadonlyMap<string, ReadonlySet<string>>,
      ): void => {
        const pkgDeps = readPackageDependencies(depRoot, readFn);
        const declaredPkgs = readDeclaredPackages(depRoot, readFn);
        const selfName = readPackageName(depRoot, readFn);

        for (const [pkgName, files] of usedPackages) {
          if (pkgName === selfName || shouldIgnore(pkgName)) {
            continue;
          }

          // A bare builtin name (`path`, `buffer`) imported without a declaration is a Node core
          // usage, not an unlisted package. (A DECLARED one stays in `usedPackages` above so it is
          // never flagged unused — the polyfill-intent hold.)
          if (!declaredPkgs.has(pkgName) && !isBuiltinModule(pkgName)) {
            unusedDeps.push({
              kind: 'unlisted-dependency',
              packageName: pkgName,
              files: [...files],
            });
          }
        }

        // Packages consumed ambiently (no import) — resolved from declared tsconfig `types` +
        // triple-slash references. When the ambient set is not closable, `closed` is false and we
        // hold every unimported dep at this root (per "닫히지 않으면 보류"). See resolveAmbientTypeHolds.
        const ambient = resolveAmbientTypeHolds(depRoot, rootAbs, readFn, listDir, new Set(absGraph.keys()), declaredPkgs);

        for (const declared of pkgDeps) {
          if (declared === selfName || shouldIgnore(declared)) {
            continue;
          }

          // Consumed via a value import (usedPackages) OR a type-only import (typeUsed) → not unused.
          if (usedPackages.has(declared) || typeUsed.has(declared)) {
            continue;
          }

          // #5 makes external `type-references` part of the used-package evidence. If that query
          // degraded (`hasTypeRefData` false), `typeUsed` is incomplete, so a dep consumed ONLY via
          // `import type` would look unused — hold every unused-dependency verdict at this root
          // (holistic review: relationsComplete gated dead/members but not unused-dependency).
          if (!hasTypeRefData) {
            continue;
          }

          // (e) Ambient set unclosable (unreadable `extends`, custom `typeRoots` without `types`,
          // unparseable tsconfig) → cannot prove any unimported dep is unconsumed → hold all.
          if (!ambient.closed) {
            continue;
          }

          // (a) @types/* is auto-included under the default typeRoot (`node_modules/@types`) and
          // consumed with no import. Held UNCONDITIONALLY — never gated on `types` presence, or a
          // `types` allowlist that omits an installed @types would become a false W. [guard G1]
          if (declared.startsWith('@types/')) {
            continue;
          }

          // (b)+(c) Declared as an ambient type via tsconfig `types` or a triple-slash reference
          // (incl. the `@types/bun` → `bun-types` reference chain) — consumed with no import.
          if (ambient.holds.has(declared)) {
            continue;
          }

          // A bin-providing dep is invocable outside the static graph (scripts, hooks, bunx,
          // manual) → non-use not provable → hold. `'unknown'` (manifest unreadable: pnpm/PnP/
          // hoist-above-root) also holds — absence of install-state is not evidence of no-bin.
          // Only a confirmed no-bin, unimported dep is reported.
          if (readDepBinState(depRoot, rootAbs, declared, readFn) !== 'no-bin') {
            continue;
          }

          unusedDeps.push({
            kind: 'unused-dependency',
            packageName: declared,
            files: [],
          });
        }
      };

      const workspaces = input?.workspacePackages;

      if (workspaces && workspaces.size > 0) {
        // Per-workspace analysis: group external imports by workspace
        const splitByWorkspace = (src: Map<string, Set<string>>, wsRel: string): Map<string, Set<string>> => {
          const out = new Map<string, Set<string>>();

          for (const [pkgName, files] of src) {
            const wsFiles = new Set<string>();

            for (const f of files) {
              if (f.startsWith(wsRel + '/') || f === wsRel) {
                wsFiles.add(f);
              }
            }

            if (wsFiles.size > 0) {
              out.set(pkgName, wsFiles);
            }
          }

          return out;
        };

        for (const [, wsRoot] of workspaces) {
          const wsRel = toRelativePath(rootAbs, wsRoot);

          checkDeps(wsRoot, splitByWorkspace(externalPackages, wsRel), splitByWorkspace(typeOnlyExternal, wsRel));
        }
      } else {
        checkDeps(rootAbs, externalPackages, typeOnlyExternal);
      }
    }
  }

  return {
    cycles,
    adjacency: adjacencyOut,
    cuts,
    layerViolations,
    deadExports,
    unusedFiles,
    unusedDeps,
    unresolvedImports,
    duplicateExports,
    unusedMembers,
  };
};

export { analyzeDependencies, createEmptyDependencies };
