import type { ParsedFile } from '../../engine/types';
import type { DuplicateGroup } from '../../types';

import { detectClones } from '../../engine/duplicate-detector';

const createEmptyStructuralDuplicates = (): ReadonlyArray<DuplicateGroup> => [];

const analyzeStructuralDuplicates = (files: ReadonlyArray<ParsedFile>, minSize: number): ReadonlyArray<DuplicateGroup> => {
  if (files.length === 0) {
    return createEmptyStructuralDuplicates();
  }

  return [...detectClones(files, minSize, 'type-2-shape'), ...detectClones(files, minSize, 'type-3-normalized')].sort(
    (left, right) => right.items.length - left.items.length || left.cloneType.localeCompare(right.cloneType),
  );
};

export { analyzeStructuralDuplicates, createEmptyStructuralDuplicates };
