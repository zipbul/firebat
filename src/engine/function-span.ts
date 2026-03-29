import type { Node } from 'oxc-parser';

import { buildLineOffsets, getLineColumn } from '@zipbul/gildash';

import type { SourceSpan } from '../types';

const getFunctionSpan = (functionNode: Node, sourceText: string): SourceSpan => {
  const offsets = buildLineOffsets(sourceText);

  return {
    start: getLineColumn(offsets, functionNode.start),
    end: getLineColumn(offsets, functionNode.end),
  };
};

export { getFunctionSpan };
