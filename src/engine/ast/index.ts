export { collectLocallyUsedImportNames } from './collect-locally-used-import-names';
export { normalizeFile } from './normalize-file';
export {
  collectFunctionNodes,
  collectFunctionNodesWithParent,
  collectOxcNodes,
  forEachChildNode,
  getLiteralString,
  getNodeHeader,
  getNodeName,
  isFunctionNode,
  isNodeRecord,
  isOxcNode,
  isOxcNodeArray,
  walkOxcTree,
  walkOxcTreeWithParent,
} from './oxc-ast-utils';
export { evalStaticLiteralValue, evalStaticNullish, evalStaticTruthiness, unwrapExpression } from './oxc-expression-utils';
export { createOxcFingerprintExact, createOxcFingerprintNormalized, createOxcFingerprintShape } from './oxc-fingerprint';
export { normalizeForFingerprint } from './ast-normalizer';
export { countOxcSize } from './oxc-size-count';
export { parseSource } from './parse-source';
