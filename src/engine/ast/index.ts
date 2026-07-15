export {
  addNodeNameIfValid,
  asRecord,
  collectFunctionNodes,
  collectFunctionNodesWithParent,
  collectOxcNodes,
  forEachChildNode,
  forEachChildWithParent,
  getLiteralString,
  getMemberPropertyName,
  getNodeHeader,
  getNodeName,
  isFunctionNode,
  isOxcNode,
  toNodeArray,
  walkOxcTree,
  walkOxcTreeWithParent,
} from './oxc-ast-utils';
export { evalStaticLiteralValue, evalStaticNullish, evalStaticTruthiness, unwrapExpression } from './oxc-expression-utils';
export { collectPatternBindingNames, collectShadowedNames } from './collect-shadowed-names';
export {
  collectBindingNames,
  createOxcFingerprintExact,
  createOxcFingerprintNormalized,
  createOxcFingerprintRun,
  createOxcFingerprintShape,
  createOxcFingerprintShapeWithBindings,
  getContractMembers,
} from './oxc-fingerprint';
export { countOxcSize } from './oxc-size-count';
export { normalizeFile } from './normalize-file';
export { spanOfNode } from './source-span';
