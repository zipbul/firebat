export { createBitSet, equalsBitSet, intersectBitSet, subtractBitSet, unionBitSet } from './dataflow';
export { computeLiveness } from './liveness';
export {
  analyzeFunctionBody,
  bindingKey,
  collectLocalVarIndexes,
  collectParameterBindings,
  extractBindingNames,
} from './reaching-defs';
export type { AnalyzeFunctionBodyOptions, BindingName } from './reaching-defs';
export { collectVariables } from './variable-collector';
