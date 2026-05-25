/**
 * Singleton holder + adapter for the gildash Semantic Layer's binding-identity
 * resolution (`getFileBindings`). When a Gildash instance is registered via
 * {@link setGildashSemanticContext}, callers that have a real on-disk filePath
 * can route through {@link tryGildashDeclScopeMap} to obtain a binding-scope
 * map that is tsc-authoritative (correct var hoisting, shadowing, ambient
 * detection, cross-file binding identity).
 *
 * When the singleton is unset, or the filePath is not indexed (e.g. virtual
 * test paths), callers fall back to the oxc-walker `ScopeTracker` path in
 * `buildDeclScopeMap`. Both paths produce the same shape: `Map<offset, string>`
 * where the value is a synthetic binding-identity key. The gildash path keys by
 * `tsc:<declaration.position>`; the fallback keys by ScopeTracker scope or
 * `var:<funcOffset>:<name>` for hoisted vars.
 */
import type { FileBinding } from '@zipbul/gildash';

interface GildashLike {
  readonly projectRoot: string;
  getFileBindings(filePath: string): FileBinding[];
}

let _gildash: GildashLike | null = null;

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

export const setGildashSemanticContext = (gildash: GildashLike | null): void => {
  _gildash = gildash;
};

export const getGildashSemanticContext = (): GildashLike | null => {
  return _gildash;
};

export const registerFixtureRealPath = (virtualPath: string, realPath: string): void => {
  _virtualToReal.set(virtualPath, realPath);
};

export const clearFixtureRealPaths = (): void => {
  _virtualToReal.clear();
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

  if (bindings.length === 0) {
    _gildashMissCount += 1;

    return null;
  }

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
