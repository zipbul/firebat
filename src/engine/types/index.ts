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
}

export interface VariableCollectorOptions {
  includeNestedFunctions?: boolean;
}

export interface DefMeta {
  readonly name: string;
  readonly varIndex: number;
  readonly location: number;
  readonly writeKind?: VariableUsage['writeKind'];
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
