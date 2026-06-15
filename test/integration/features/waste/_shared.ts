import type { WasteFinding } from '../../../../src/test-api';

import { detectWaste } from '../../../../src/test-api';
import { createProgramFromMap } from '../../shared/test-kit';

/**
 * Parse a single virtual source under `filePath`, run the waste detector, and
 * return its findings.
 *
 * Collapses the `Map`-build + `createProgramFromMap` + `detectWaste` preamble
 * that every single-source waste sibling spec otherwise restates verbatim.
 */
export const detectWasteForSource = (filePath: string, source: string): WasteFinding[] => {
  const sources = new Map<string, string>();

  sources.set(filePath, source);

  const program = createProgramFromMap(sources);

  return detectWaste(program);
};

/** Findings from `detectWasteForSource` filtered to a single `label`. */
export const detectWasteLabelFindings = (filePath: string, source: string, label: string): WasteFinding[] => {
  return detectWasteForSource(filePath, source).filter(finding => finding.label === label);
};
