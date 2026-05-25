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

export const setGildashSemanticContext = (gildash: GildashLike | null): void => {
  _gildash = gildash;
};

export const getGildashSemanticContext = (): GildashLike | null => {
  return _gildash;
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
    return null;
  }

  if (!filePath.startsWith('/')) {
    return null;
  }

  // Convert absolute path to project-relative for the gildash query.
  const root = _gildash.projectRoot;
  const rel = filePath.startsWith(root + '/') ? filePath.slice(root.length + 1) : filePath;

  let bindings: FileBinding[];

  try {
    bindings = _gildash.getFileBindings(rel);
  } catch {
    return null;
  }

  if (bindings.length === 0) {
    return null;
  }

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
