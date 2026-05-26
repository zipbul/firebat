// KEEP boundary: an enclosing variable written inside an IIFE. The IIFE runs
// immediately and reads/writes `totalBytes`; the write belongs to the IIFE's
// own scope and is analyzed in its own pass. The enclosing module/function
// analysis must NOT record that write as one of its own defs — doing so left
// the write with no enclosing-CFG node to reach its (also-inside-IIFE) read,
// misreporting a dead store. (Found running waste on the `ky` codebase.)
export function f(items: number[], max: number): string {
  const chunks: string[] = [];
  let totalBytes = 0;

  const result = ((): string => {
    for (const value of items) {
      totalBytes += value;
      if (totalBytes > max) {
        return 'over';
      }

      chunks.push(String(value));
    }

    return chunks.join('|');
  })();

  return result;
}
