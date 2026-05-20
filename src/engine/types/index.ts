import type { Node } from 'oxc-parser';

import type { IntegerCFG, NodeId } from '../cfg';

export { EdgeType } from '../cfg';
export type { NodeId } from '../cfg';

export interface BitSet {
  add(index: number): void;
  remove(index: number): void;
  has(index: number): boolean;
  new_union(other: BitSet): BitSet;
  new_intersection(other: BitSet): BitSet;
  difference(other: BitSet): void;
  clone(): BitSet;
  equals(other: BitSet): boolean;
  array(): number[];
  size(): number;
}

export interface VariableUsage {
  name: string;
  isWrite: boolean;
  isRead: boolean;
  location: number;
  writeKind?: 'declaration' | 'assignment' | 'compound-assignment' | 'logical-assignment' | 'update';
  /**
   * For `writeKind === 'declaration'` only. False for binding-only declarations (`let x;`)
   * that create a binding but do not write a value. Undefined otherwise.
   */
  hasInit?: boolean;
  /**
   * For `writeKind === 'declaration'` only. The keyword used by the enclosing
   * `VariableDeclaration` (`let` / `const` / `var` / `using` / `await using`).
   */
  declarationKind?: 'let' | 'const' | 'var' | 'using' | 'await using';
  /**
   * The lexical-scope key of the declaration this usage resolves to. Same-named
   * bindings in different scopes (e.g. outer `x` shadowed by inner `let x`) have
   * different `declScope` values, so dataflow can keep them as separate variables.
   * `undefined` when the usage refers to a binding not visible in the function
   * being analyzed (e.g. globals, closure captures, or unresolved names).
   */
  declScope?: string;
}

export interface VariableCollectorOptions {
  includeNestedFunctions?: boolean;
  /**
   * Pre-computed `Map<identifierStart, declarationScopeKey>` covering the function
   * (or other) enclosing scope. When supplied, usages of bindings declared outside
   * the traversed node (e.g. function parameters when traversing only the body)
   * still receive a `declScope`, letting `bindingKey(name, declScope)` resolve to
   * the correct variable index even across scope boundaries.
   */
  declScopeByIdLocation?: ReadonlyMap<number, string>;
  /**
   * If true, traverse every branch of logical and conditional expressions even when
   * static analysis shows one side is dead (e.g. `1 ?? fallback` — `fallback` would
   * never be evaluated). Used for purely *syntactic* read counting that ignores
   * reachability. Default false (semantic traversal, matches reaching-defs).
   */
  evaluateAllBranches?: boolean;
}

export interface DefMeta {
  readonly name: string;
  readonly varIndex: number;
  readonly location: number;
  readonly writeKind?: VariableUsage['writeKind'];
  /**
   * For `writeKind === 'declaration'` only. False for binding-only declarations (`let x;`)
   * that declare a binding but do not write a value. Other defs leave this undefined.
   */
  readonly hasInit?: boolean;
  /**
   * For `writeKind === 'declaration'` only. The declaration keyword used.
   */
  readonly declarationKind?: VariableUsage['declarationKind'];
  /**
   * The lexical scope of the declaration this def binds (see `VariableUsage.declScope`).
   */
  readonly declScope?: string;
}

export interface FunctionBodyAnalysis {
  readonly usedDefs: BitSet;
  readonly overwrittenDefIds: ReadonlyArray<boolean>;
  readonly defs: ReadonlyArray<DefMeta>;
  readonly reachingInByNode: ReadonlyArray<BitSet>;
  readonly defNodeIdByDefId: ReadonlyArray<number>;
  readonly nodePayloads: ReadonlyArray<CfgNodePayload | null>;
  readonly cfg: IntegerCFG;
  readonly exitId: NodeId;
  readonly useVarIndexesByNode: ReadonlyArray<ReadonlyArray<number>>;
  readonly writeVarIndexesByNode: ReadonlyArray<ReadonlyArray<number>>;
  readonly defsOfVar: ReadonlyArray<BitSet>;
}

export type NodeValue = Node | ReadonlyArray<NodeValue> | string | number | boolean | null | undefined;

export type NodeRecord = Node & Record<string, NodeValue>;

export type CfgNodePayload = Node | ReadonlyArray<Node>;

export type { ParsedFile } from '@zipbul/gildash';

export interface OxcBuiltFunctionCfg {
  readonly cfg: IntegerCFG;
  readonly entryId: NodeId;
  readonly exitId: NodeId;
  readonly nodePayloads: ReadonlyArray<CfgNodePayload | null>;
}

export interface LoopTargets {
  readonly breakTarget: NodeId;
  readonly continueTarget: NodeId;
  readonly label: string | null;
}
