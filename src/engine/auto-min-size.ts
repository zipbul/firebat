import type { ParsedFile } from './types';

import { isCloneTarget } from './duplicate-detector';
import { collectOxcNodes } from './oxc-ast-utils';
import { countOxcSize } from './oxc-size-count';

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export const computeAutoMinSize = (files: ReadonlyArray<ParsedFile>): number => {
  const counts: number[] = [];

  for (const file of files) {
    if (file.errors.length > 0) {
      continue;
    }

    const targets = collectOxcNodes(file.program, isCloneTarget);

    for (const node of targets) {
      counts.push(countOxcSize(node));
    }
  }

  if (counts.length === 0) {
    return 60;
  }

  counts.sort((a, b) => a - b);

  // Heuristic: keep recall reasonably high by default.
  // For small/medium repos, use a median-ish threshold; for large repos, raise the percentile
  // to avoid boilerplate dominating results.
  const fileCount = files.length;
  const percentile = fileCount >= 1000 ? 0.75 : fileCount >= 500 ? 0.6 : 0.5;
  const index = Math.floor((counts.length - 1) * percentile);
  const selected = counts[index] ?? 60;

  return clamp(Math.round(selected), 10, 200);
};
