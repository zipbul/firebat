export {
  analyzeFunctionBody,
  bindingKey,
  collectLocalVarIndexes,
  collectParameterBindings,
  densifyKeys,
  resolveVarIndex,
} from './reaching-defs';
export type { AnalyzeFunctionBodyOptions, BindingName } from './reaching-defs';
export { BindingUnresolvedError, buildDeclScopeMap, collectVariables } from './variable-collector';
export { intersectBitSet } from './dataflow';
export { computeLiveness } from './liveness';
export { getGildashSemanticContext, setGildashSemanticContext } from './gildash-binding-source';
