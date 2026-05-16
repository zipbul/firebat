export { computeAutoMinSize } from './auto-min-size';
export { collectFunctionItems } from './function-items';
export { hashString } from './hasher';
export { PartialResultError } from './partial-result-error';
export { runWithConcurrency } from './promise-pool';
export type { ResolvedType, SemanticReference } from './semantic-types';
export type {
  BitSet,
  CfgNodePayload,
  FunctionBodyAnalysis,
  NodeRecord,
  OxcBuiltFunctionCfg,
  ParsedFile,
  VariableUsage,
} from './types';
export { EdgeType } from './types';
export { detectWasteOxc } from './waste-detector-oxc';
