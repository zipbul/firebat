import type { Function as OxcFunction, Node } from 'oxc-parser';

import type { BitSet, DefMeta, FunctionBodyAnalysis } from '../types';

import { OxcCFGBuilder } from '../cfg/cfg-builder';
import { createBitSet, equalsBitSet, intersectBitSet, subtractBitSet, unionBitSet } from './dataflow';
import { getNodeName } from '../ast/oxc-ast-utils';
import { collectVariables } from './variable-collector';

export interface BindingName {
  readonly name: string;
  readonly location: number;
}

export const extractBindingNames = (node: Node, out: BindingName[]): void => {
  if (node.type === 'Identifier') {
    const name = getNodeName(node);

    if (name !== null) {
      out.push({ name, location: node.start });
    }

    return;
  }

  if (node.type === 'ObjectPattern') {
    for (const prop of node.properties) {
      if (prop.type === 'Property') {
        extractBindingNames(prop.value as Node, out);

        continue;
      }

      if (prop.type === 'RestElement') {
        extractBindingNames(prop.argument as Node, out);
      }
    }

    return;
  }

  if (node.type === 'ArrayPattern') {
    for (const element of node.elements) {
      if (element !== null && element !== undefined) {
        extractBindingNames(element as Node, out);
      }
    }

    return;
  }

  if (node.type === 'AssignmentPattern') {
    extractBindingNames(node.left as Node, out);

    return;
  }

  if (node.type === 'RestElement') {
    extractBindingNames(node.argument as Node, out);
  }
};

export const collectParameterBindings = (functionNode: Node): ReadonlyArray<BindingName> => {
  const bindings: BindingName[] = [];
  const fn = functionNode as OxcFunction;
  const params = fn.params as ReadonlyArray<Node>;

  for (const param of params) {
    extractBindingNames(param, bindings);
  }

  return bindings;
};

export const collectLocalVarIndexes = (functionNode: Node): Map<string, number> => {
  const names = new Set<string>();
  const parameterBindings = collectParameterBindings(functionNode);

  for (const binding of parameterBindings) {
    names.add(binding.name);
  }

  const fn2 = functionNode as OxcFunction;
  const bodyNode = fn2.body as Node | null;
  const bodyUsages = bodyNode !== null ? collectVariables(bodyNode, { includeNestedFunctions: false }) : [];

  for (const usage of bodyUsages) {
    if (usage.isWrite && usage.writeKind === 'declaration') {
      names.add(usage.name);
    }
  }

  const out = new Map<string, number>();
  let index = 0;

  for (const name of names) {
    out.set(name, index);

    index += 1;
  }

  return out;
};

const unionAll = (sets: readonly BitSet[], empty: BitSet): BitSet => {
  let current = empty;

  for (const set of sets) {
    current = unionBitSet(current, set);
  }

  return current;
};

export const analyzeFunctionBody = (
  bodyNode: Node | ReadonlyArray<Node> | undefined,
  localIndexByName: Map<string, number>,
  parameterBindings: ReadonlyArray<BindingName>,
): FunctionBodyAnalysis => {
  const cfgBuilder = new OxcCFGBuilder();
  const built = cfgBuilder.buildFunctionBody(bodyNode);
  const nodeCount = built.cfg.nodeCount;
  const nodePayloads = built.nodePayloads;
  const entryId = built.entryId;
  const defsByVarIndex: number[][] = Array.from({ length: localIndexByName.size }, () => []);
  const defMetaById: DefMeta[] = [];
  const genDefIdsByNode: number[][] = Array.from({ length: nodeCount }, () => []);
  const useVarIndexesByNode: number[][] = Array.from({ length: nodeCount }, () => []);
  const writeVarIndexesByNode: number[][] = Array.from({ length: nodeCount }, () => []);
  const defNodeIdByDefId: number[] = [];

  // Seed parameter bindings as definitions at CFG entry so unused params can be detected.
  for (const binding of parameterBindings) {
    const varIndex = localIndexByName.get(binding.name);

    if (typeof varIndex !== 'number') {
      continue;
    }

    const defId = defMetaById.length;

    defMetaById.push({ name: binding.name, varIndex, location: binding.location, writeKind: 'declaration' });
    defsByVarIndex[varIndex]?.push(defId);
    genDefIdsByNode[entryId]?.push(defId);

    defNodeIdByDefId[defId] = entryId;
  }

  for (let nodeId = 0; nodeId < nodeCount; nodeId += 1) {
    const payload = nodePayloads[nodeId];

    if (!payload) {
      continue;
    }

    const usages = Array.isArray(payload)
      ? payload.flatMap(p => collectVariables(p, { includeNestedFunctions: false }))
      : collectVariables(payload as Node, { includeNestedFunctions: false });
    const useIndexes = new Set<number>();
    const writeIndexes = new Set<number>();

    for (const usage of usages) {
      const varIndex = localIndexByName.get(usage.name);

      if (typeof varIndex !== 'number') {
        continue;
      }

      if (usage.isRead) {
        useIndexes.add(varIndex);
      }

      if (usage.isWrite) {
        writeIndexes.add(varIndex);

        const defId = defMetaById.length;
        const meta: DefMeta = usage.writeKind
          ? {
              name: usage.name,
              varIndex,
              location: usage.location,
              writeKind: usage.writeKind,
            }
          : {
              name: usage.name,
              varIndex,
              location: usage.location,
            };

        defMetaById.push(meta);

        defNodeIdByDefId[defId] = nodeId;

        defsByVarIndex[varIndex]?.push(defId);
        genDefIdsByNode[nodeId]?.push(defId);
      }
    }

    useVarIndexesByNode[nodeId] = [...useIndexes];
    writeVarIndexesByNode[nodeId] = [...writeIndexes];
  }

  const defCount = defMetaById.length;
  const empty = createBitSet();
  const genByNode: BitSet[] = [];
  const killByNode: BitSet[] = [];
  const defsOfVar: BitSet[] = [];

  for (let index = 0; index < nodeCount; index += 1) {
    genByNode.push(createBitSet());
    killByNode.push(createBitSet());
  }

  for (let index = 0; index < localIndexByName.size; index += 1) {
    defsOfVar.push(createBitSet());
  }

  for (let varIndex = 0; varIndex < defsByVarIndex.length; varIndex += 1) {
    const ids = defsByVarIndex[varIndex] ?? [];

    for (const defId of ids) {
      defsOfVar[varIndex]?.add(defId);
    }
  }

  for (let nodeId = 0; nodeId < nodeCount; nodeId += 1) {
    const genIds = genDefIdsByNode[nodeId] ?? [];

    for (const defId of genIds) {
      genByNode[nodeId]?.add(defId);
    }

    let kill = createBitSet();
    const writtenVars = writeVarIndexesByNode[nodeId] ?? [];

    for (const varIndex of writtenVars) {
      const defs = defsOfVar[varIndex];

      if (!defs) {
        continue;
      }

      kill = unionBitSet(kill, defs);
    }

    killByNode[nodeId] = subtractBitSet(kill, genByNode[nodeId] ?? createBitSet());
  }

  const pred = built.cfg.buildAdjacency('backward');
  const inByNode: BitSet[] = [];
  const outByNode: BitSet[] = [];

  for (let index = 0; index < nodeCount; index += 1) {
    inByNode.push(createBitSet());
    outByNode.push(createBitSet());
  }

  let changed = true;

  while (changed) {
    changed = false;

    for (let nodeId = 0; nodeId < nodeCount; nodeId += 1) {
      const predIds = pred[nodeId] ?? new Int32Array();
      const predOutSets: BitSet[] = [];

      for (const p of predIds) {
        const out = outByNode[p];

        if (out) {
          predOutSets.push(out);
        }
      }

      const nextIn = unionAll(predOutSets, empty.clone());
      const nextOut = unionBitSet(
        genByNode[nodeId] ?? createBitSet(),
        subtractBitSet(nextIn, killByNode[nodeId] ?? createBitSet()),
      );

      if (!equalsBitSet(nextIn, inByNode[nodeId] ?? createBitSet())) {
        inByNode[nodeId] = nextIn;
        changed = true;
      }

      if (!equalsBitSet(nextOut, outByNode[nodeId] ?? createBitSet())) {
        outByNode[nodeId] = nextOut;
        changed = true;
      }
    }
  }

  let usedDefs = createBitSet();

  for (let nodeId = 0; nodeId < nodeCount; nodeId += 1) {
    const uses = useVarIndexesByNode[nodeId] ?? [];
    const reachingIn = inByNode[nodeId] ?? createBitSet();

    for (const varIndex of uses) {
      const defs = defsOfVar[varIndex];

      if (!defs) {
        continue;
      }

      usedDefs = unionBitSet(usedDefs, intersectBitSet(reachingIn, defs));
    }
  }

  const overwrittenDefIds: boolean[] = Array.from({ length: defCount }, () => false);

  for (let nodeId = 0; nodeId < nodeCount; nodeId += 1) {
    const writtenVars = writeVarIndexesByNode[nodeId] ?? [];
    const reachingIn = inByNode[nodeId] ?? createBitSet();

    for (const varIndex of writtenVars) {
      const defs = defsOfVar[varIndex];

      if (!defs) {
        continue;
      }

      const killedHere = subtractBitSet(intersectBitSet(reachingIn, defs), genByNode[nodeId] ?? createBitSet());
      const killedIds = killedHere.array();

      for (const defId of killedIds) {
        overwrittenDefIds[defId] = true;
      }
    }
  }

  return {
    usedDefs,
    overwrittenDefIds,
    defs: defMetaById,
    reachingInByNode: inByNode,
    defNodeIdByDefId,
    nodePayloads,
    cfg: built.cfg,
    exitId: built.exitId,
    useVarIndexesByNode,
    writeVarIndexesByNode,
    defsOfVar,
  };
};
