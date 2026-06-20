/**
 * Maps a unit spec path (`foo.spec.ts`) to its colocated implementation path
 * (`foo.ts`). Shared by the test-file rules so the spec<->impl naming
 * convention lives in one place.
 */
function getImplPathFromSpec(specPath: string): string {
  return specPath.replace(/\.spec\.ts$/, '.ts');
}

export { getImplPathFromSpec };
