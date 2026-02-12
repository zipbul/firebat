import type { Comment, Node, OxcError, Program } from 'oxc-parser';

import type { FirebatItemKind } from '../types';
import type { IntegerCFG } from './cfg';
import type { NodeId } from './cfg-types';

export type { WriteBehindQueue } from './write-behind-queue';

export { EdgeType } from './cfg-types';
export type { NodeId } from './cfg-types';

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
}

export type NodeValue = Node | ReadonlyArray<NodeValue> | string | number | boolean | null | undefined;

export type NodeValueVisitor = (value: NodeValue) => void;

export type OxcNodePredicate = (node: Node) => boolean;

export type OxcNodeWalker = (node: Node) => boolean;

export type DuplicateFingerprintResolver = (node: Node) => string;

export type DuplicateItemKindResolver = (node: Node) => FirebatItemKind;

export type NodeRecord = Node & Record<string, NodeValue>;

export type NodeWithBody = Node & Record<'body', Node | ReadonlyArray<Node> | null | undefined>;

export type NodeWithParams = Node & Record<'params', ReadonlyArray<Node>>;

export type NodeWithValue = Node & Record<'value', string | number | boolean | bigint | null>;

export type CfgNodePayload = Node | ReadonlyArray<Node>;

export interface ParsedFile {
  filePath: string;
  program: Program;
  errors: ReadonlyArray<OxcError>;
  comments: ReadonlyArray<Comment>;
  sourceText: string;
}

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
