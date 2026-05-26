// KEEP boundary: direct members of a TS namespace are non-target (CLAUDE.md:
// "namespace 비대상"). They are cross-namespace-visible surface (like exports),
// so removing one needs cross-reference analysis outside waste's scope — even
// when the member appears overwritten or only used within the namespace.
export namespace util {
  export const objectKeys = (obj: Record<string, unknown>): string[] => Object.keys(obj);

  export const objectValues = (obj: Record<string, unknown>): unknown[] => {
    return objectKeys(obj).map(e => obj[e]);
  };
}
