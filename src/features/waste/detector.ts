import type { ParsedFile } from '../../engine/types';
import type { WasteFinding } from '../../types';

import { detectWasteOxc } from '../../engine/waste-detector-oxc';

export interface WasteDetectorOptions {
  readonly memoryRetentionThreshold?: number;
}

export const detectWaste = (files: ParsedFile[], options?: WasteDetectorOptions): WasteFinding[] => {
  if (files.length === 0) {
    return [];
  }

  return detectWasteOxc(files, options);
};
