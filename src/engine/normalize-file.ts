/**
 * Normalizes a file path to a project-relative path.
 *
 * - If the path contains a `/src/` segment, returns the path from `src/` onward.
 * - Otherwise returns the basename of the path (last path segment).
 * - Normalizes Windows backslashes to forward slashes.
 */
const normalizeFile = (filePath: string): string => {
  const normalized = filePath.replaceAll('\\', '/');
  const idx = normalized.lastIndexOf('/src/');

  if (idx >= 0) {
    return normalized.slice(idx + 1);
  }

  // Already a relative path starting with src/ (e.g. 'src/features/foo.ts')
  if (normalized.startsWith('src/') || normalized === 'src') {
    return normalized;
  }

  // No /src/ segment — return basename to avoid leaking absolute path tokens
  const lastSlash = normalized.lastIndexOf('/');

  if (lastSlash >= 0) {
    return normalized.slice(lastSlash + 1);
  }

  return normalized;
};

export { normalizeFile };
