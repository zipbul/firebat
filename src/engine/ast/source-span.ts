import type { Node } from 'oxc-parser';

import { buildLineOffsets, getLineColumn } from '@zipbul/gildash';

import type { SourceSpan } from '../../types';

/**
 * Resolve the {line, column} span of an OXC node within its source text.
 *
 * Shared single source of truth for the `(node, sourceText) -> SourceSpan`
 * helper that several detectors had each re-declared verbatim.
 */
export const spanOfNode = (node: Node, sourceText: string): SourceSpan => {
  const offsets = buildLineOffsets(sourceText);

  return {
    start: getLineColumn(offsets, node.start),
    end: getLineColumn(offsets, node.end),
  };
};
