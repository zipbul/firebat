import type { ParsedFile } from '../../engine/types';
import type { WasteFinding } from '../../types';

import { detectWasteOxc } from '../../engine';

export const detectWaste = (files: ParsedFile[]): WasteFinding[] => {
  if (files.length === 0) {
    return [];
  }

  return detectWasteOxc(files);
};
