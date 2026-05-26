/**
 * Adapter over the gildash Semantic Layer's binding-identity resolution
 * (`getFileBindings` / `getFileBindingsBatch`). Production scan and the test
 * preload (`global-setup.ts`) register a single {@link Gildash} instance via
 * {@link setGildashSemanticContext}; thereafter all dataflow callers route
 * binding resolution through {@link tryGildashDeclScopeMap}, which is
 * tsc-authoritative (correct var hoisting, shadowing, declaration merging,
 * ambient detection, cross-file identity).
 *
 * In-memory test sources (no on-disk backing) are registered with the
 * semantic layer through {@link registerVirtualSourcesBatch} — one tsc
 * Program rebuild per batch instead of per file.
 *
 * Result map shape: `Map<offset, string>` where the value is
 * `tsc:<declaration.position>`, uniquely identifying the binding by its
 * tsc-resolved declaration site (used downstream by `bindingKey`).
 */
import type { FileBinding, Gildash } from '@zipbul/gildash';

let _gildash: Gildash | null = null;

/**
 * Virtual → real-disk path mapping used by the test runner so that
 * `tryGildashDeclScopeMap` can query gildash with a real path while keeping
 * ParsedFile.filePath in its historical `/virtual/...` form. Production code
 * passes real disk paths directly and never registers entries here.
 */
const _virtualToReal = new Map<string, string>();

// Telemetry counters — used by tests to assert the gildash path was actually
// taken vs the ScopeTracker fallback.
let _gildashHitCount = 0;
let _gildashMissCount = 0;

export const getBindingSourceTelemetry = (): { gildashHits: number; gildashMisses: number } => {
  return { gildashHits: _gildashHitCount, gildashMisses: _gildashMissCount };
};

export const resetBindingSourceTelemetry = (): void => {
  _gildashHitCount = 0;
  _gildashMissCount = 0;
};

export const setGildashSemanticContext = (gildash: Gildash | null): void => {
  _gildash = gildash;
};

export const getGildashSemanticContext = (): Gildash | null => {
  return _gildash;
};

export const registerFixtureRealPath = (virtualPath: string, realPath: string): void => {
  _virtualToReal.set(virtualPath, realPath);
};

export const clearFixtureRealPaths = (): void => {
  _virtualToReal.clear();
};

/**
 * Batch-register a set of in-memory sources with the active Gildash semantic
 * layer and pre-compute every file's binding map in a single tsc Program
 * rebuild. Pass this list once per "logical analysis unit" (a test case, a
 * detector call across N files) instead of interleaving per-file
 * notify/query pairs, which forces a rebuild per file (10× slower per
 * gildash 0.31 release notes).
 *
 * Registers the virtual → target mapping so tryGildashDeclScopeMap can
 * resolve queries keyed on the virtual path. Returns the
 * Map<virtualPath, FileBinding[]> for callers that want to inspect bindings
 * directly without going through tryGildashDeclScopeMap.
 *
 * Throws when no Gildash semantic context is registered.
 */
export const registerVirtualSourcesBatch = (
  entries: ReadonlyArray<{ virtualPath: string; targetPath: string; content: string }>,
): Map<string, FileBinding[]> => {
  if (_gildash === null) {
    throw new Error(
      'registerVirtualSourcesBatch: no Gildash semantic context registered. ' +
        'Tests must load test/integration/shared/global-setup.ts via bunfig preload.',
    );
  }

  if (entries.length === 0) {
    return new Map();
  }

  const batch = entries.map(e => ({ filePath: e.targetPath, content: e.content }));
  const byTarget = _gildash.getFileBindingsBatch(batch);
  const byVirtual = new Map<string, FileBinding[]>();

  for (const e of entries) {
    _virtualToReal.set(e.virtualPath, e.targetPath);

    const bindings = byTarget.get(e.targetPath) ?? [];

    byVirtual.set(e.virtualPath, bindings);
  }

  return byVirtual;
};

/**
 * Remove an in-memory source from the semantic layer and drop the
 * virtual→real mapping. Use in test cleanup hooks (`afterEach`) to keep the
 * tsc Program bounded — fuzz / property tests that generate hundreds of
 * ad-hoc sources per case should call this for each one to avoid linear
 * growth in batch cost.
 */
export const unregisterVirtualSource = (virtualPath: string): void => {
  const targetPath = _virtualToReal.get(virtualPath);

  if (targetPath === undefined) {
    return;
  }

  if (_gildash !== null) {
    _gildash.notifyFileDeleted(targetPath);
  }

  _virtualToReal.delete(virtualPath);
};

/**
 * Attempt to build a declaration-scope map via gildash for the given filePath.
 * Returns null when no singleton is registered, the path is not absolute, or
 * gildash has no bindings for the file (not indexed / virtual path).
 *
 * Map value format: `tsc:<declaration.position>` — uniquely identifies the
 * binding by its tsc-resolved declaration site, regardless of name or scope
 * chain. Equivalent to the bindingKey component for downstream consumers.
 */
export const tryGildashDeclScopeMap = (
  filePath: string | undefined,
): ReadonlyMap<number, string> | null => {
  if (_gildash === null || filePath === undefined) {
    _gildashMissCount += 1;

    return null;
  }

  // Resolve through the virtual→real-disk mapping first; production code
  // passes real paths and skips this step.
  const realDiskPath = _virtualToReal.get(filePath) ?? filePath;

  if (!realDiskPath.startsWith('/')) {
    _gildashMissCount += 1;

    return null;
  }

  const root = _gildash.projectRoot;
  const rel = realDiskPath.startsWith(root + '/') ? realDiskPath.slice(root.length + 1) : realDiskPath;

  let bindings: FileBinding[];

  try {
    bindings = _gildash.getFileBindings(rel);
  } catch {
    _gildashMissCount += 1;

    return null;
  }

  // An empty result is a VALID answer: the file has no local variable
  // bindings (e.g. a re-export-only module like `export * from './b'`).
  // Returning an empty map lets the detector run and report nothing, which
  // is correct — distinct from a `null` "could not resolve" signal that
  // forces the caller to throw. With the parseSource hook + scan semantic
  // bootstrap, every analyzed file is registered, so reaching this point
  // means the file IS known to the semantic layer.
  _gildashHitCount += 1;

  const map = new Map<number, string>();

  for (const b of bindings) {
    const key = `tsc:${b.declaration.position}`;

    map.set(b.declaration.position, key);

    for (const r of b.references) {
      map.set(r.position, key);
    }
  }

  return map;
};
