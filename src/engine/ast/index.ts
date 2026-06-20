export { collectLocallyUsedImportNames } from './collect-locally-used-import-names';
export { normalizeFile } from './normalize-file';
export {
  asRecord,
  collectFunctionNodes,
  collectFunctionNodesWithParent,
  collectOxcNodes,
  forEachChildNode,
  forEachChildWithParent,
  getLiteralString,
  getNodeHeader,
  getNodeName,
  isFunctionNode,
  isNodeRecord,
  isOxcNode,
  isOxcNodeArray,
  toNodeArray,
  walkOxcTree,
  walkOxcTreeWithParent,
} from './oxc-ast-utils';
export { evalStaticLiteralValue, evalStaticNullish, evalStaticTruthiness, unwrapExpression } from './oxc-expression-utils';
export { createOxcFingerprintExact, createOxcFingerprintNormalized, createOxcFingerprintShape } from './oxc-fingerprint';
export { normalizeForFingerprint } from './ast-normalizer';
export { countOxcSize } from './oxc-size-count';
export { parseSource } from './parse-source';
export { spanOfNode } from './source-span';
