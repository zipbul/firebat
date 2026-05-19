// KEEP boundary (case 1·5의 반례): while-loop iteration idiom
// 'm = rx.exec(text)'은 condition 자체에서 read되고 body에서 'm[0]' read.
// 표준 패턴 — 모든 write가 use에 도달함.

export function extractMatches(text: string): string[] {
  const results: string[] = [];
  let m: RegExpExecArray | null;
  const rx = /\d+/g;

  while ((m = rx.exec(text)) !== null) {
    results.push(m[0]);
  }

  return results;
}
