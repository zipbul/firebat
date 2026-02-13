import type { Node } from 'oxc-parser';

import type { WasteFinding } from '../types';
import type { BitSet, DefMeta, FunctionBodyAnalysis, NodeValue, ParsedFile } from './types';

import { OxcCFGBuilder } from './cfg-builder';
import { createBitSet, equalsBitSet, intersectBitSet, subtractBitSet, unionBitSet } from './dataflow';
import {
  collectOxcNodes,
  getNodeName,
  getNodeType,
  isFunctionNode,
  isNodeRecord,
  isOxcNode,
  isOxcNodeArray,
} from './oxc-ast-utils';
import { getLineColumn } from './source-position';
import { collectVariables } from './variable-collector';

interface WasteDetectorOptions {
  readonly memoryRetentionThreshold?: number;
}

interface BindingName {
  readonly name: string;
  readonly location: number;
}

const extractBindingNames = (node: Node, out: BindingName[]): void => {
  const nodeType = getNodeType(node);

  if (nodeType === 'Identifier') {
    const name = getNodeName(node);

    if (name !== null) {
      out.push({ name, location: node.start });
    }

    return;
  }

  if (nodeType === 'ObjectPattern' && isNodeRecord(node)) {
    const properties = node.properties;

    if (!Array.isArray(properties)) {
      return;
    }

    for (const prop of properties) {
      if (!isOxcNode(prop)) {
        continue;
      }

      if (getNodeType(prop) === 'Property' && isNodeRecord(prop)) {
        const value = prop.value ?? prop.key;

        if (isOxcNode(value)) {
          extractBindingNames(value, out);
        }

        continue;
      }

      if (getNodeType(prop) === 'RestElement' && isNodeRecord(prop)) {
        const argument = prop.argument;

        if (isOxcNode(argument)) {
          extractBindingNames(argument, out);
        }
      }
    }

    return;
  }

  if (nodeType === 'ArrayPattern' && isNodeRecord(node)) {
    const elements = node.elements;

    if (!Array.isArray(elements)) {
      return;
    }

    for (const element of elements) {
      if (isOxcNode(element)) {
        extractBindingNames(element, out);
      }
    }

    return;
  }

  if (nodeType === 'AssignmentPattern' && isNodeRecord(node)) {
    const left = node.left;

    if (isOxcNode(left)) {
      extractBindingNames(left, out);
    }

    return;
  }

  if (nodeType === 'RestElement' && isNodeRecord(node)) {
    const argument = node.argument;

    if (isOxcNode(argument)) {
      extractBindingNames(argument, out);
    }
  }
};

const collectParameterBindings = (functionNode: Node): ReadonlyArray<BindingName> => {
  const bindings: BindingName[] = [];
  const paramsValue = isNodeRecord(functionNode) ? functionNode.params : undefined;
  const params = isOxcNodeArray(paramsValue) ? paramsValue : [];

  for (const param of params) {
    if (!isOxcNode(param)) {
      continue;
    }

    extractBindingNames(param, bindings);
  }

  return bindings;
};

const collectLocalVarIndexes = (functionNode: Node): Map<string, number> => {
  const names = new Set<string>();
  const parameterBindings = collectParameterBindings(functionNode);

  for (const binding of parameterBindings) {
    names.add(binding.name);
  }

  const bodyNode = isNodeRecord(functionNode) ? functionNode.body : undefined;
  const bodyUsages = collectVariables(bodyNode, { includeNestedFunctions: false });

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

const analyzeFunctionBody = (
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

    const usages = collectVariables(payload, { includeNestedFunctions: false });
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
  };
};

const computeMinPayloadStepsToExit = (
  cfg: FunctionBodyAnalysis['cfg'],
  nodePayloads: ReadonlyArray<FunctionBodyAnalysis['nodePayloads'][number]>,
  fromNodeId: number,
  exitId: number,
): number | null => {
  const nodeCount = nodePayloads.length;

  if (fromNodeId < 0 || fromNodeId >= nodeCount) {
    return null;
  }

  if (exitId < 0 || exitId >= nodeCount) {
    return null;
  }

  const succ = cfg.buildAdjacency('forward');
  const INF = Number.POSITIVE_INFINITY;
  const dist: number[] = Array.from({ length: nodeCount }, () => INF);
  const deque: number[] = [];

  dist[fromNodeId] = 0;

  deque.push(fromNodeId);

  while (deque.length > 0) {
    const current = deque.shift();

    if (typeof current !== 'number') {
      break;
    }

    if (current === exitId) {
      break;
    }

    const nextIds = succ[current] ?? new Int32Array();

    for (const next of nextIds) {
      const payloadCost = nodePayloads[next] ? 1 : 0;
      const nextDist = (dist[current] ?? INF) + payloadCost;

      if (nextDist < (dist[next] ?? INF)) {
        dist[next] = nextDist;

        if (payloadCost === 0) {
          deque.unshift(next);
        } else {
          deque.push(next);
        }
      }
    }
  }

  const result = dist[exitId] ?? INF;

  return Number.isFinite(result) ? result : null;
};

export const detectWasteOxc = (files: ParsedFile[], options?: WasteDetectorOptions): WasteFinding[] => {
  const findings: WasteFinding[] = [];
  const memoryRetentionThreshold = Math.max(0, Math.round(options?.memoryRetentionThreshold ?? 10));

  if (!Array.isArray(files)) {
    return [];
  }

  for (const file of files) {
    if (file.errors.length > 0) {
      continue;
    }

    const visit = (node: Node | ReadonlyArray<Node> | undefined): void => {
      if (Array.isArray(node)) {
        const entries = node as ReadonlyArray<Node>;

        for (const entry of entries) {
          visit(entry);
        }

        return;
      }

      if (!isOxcNode(node)) {
        return;
      }

      const functionBody = isNodeRecord(node) ? node.body : undefined;
      const functionBodyNode = isOxcNode(functionBody) || Array.isArray(functionBody) ? functionBody : undefined;

      if (isFunctionNode(node) && functionBodyNode !== undefined) {
        const localIndexByName = collectLocalVarIndexes(node);
        const parameterBindings = collectParameterBindings(node);

        if (localIndexByName.size === 0) {
          return;
        }

        const analysis = analyzeFunctionBody(functionBodyNode, localIndexByName, parameterBindings);
        const defs = analysis.defs;
        const usedDefs = analysis.usedDefs;
        const overwrittenDefIds = analysis.overwrittenDefIds;
        const reachingInByNode = analysis.reachingInByNode;
        const nodePayloads = analysis.nodePayloads;
        const exitId = analysis.exitId;
        const cfg = analysis.cfg;
        const varHasAnyUsedDef: boolean[] = Array.from({ length: localIndexByName.size }, () => false);
        const nameByVarIndex: string[] = Array.from({ length: localIndexByName.size }, () => '');

        for (const [name, index] of localIndexByName.entries()) {
          nameByVarIndex[index] = name;
        }

        const allReads = collectVariables(functionBodyNode, { includeNestedFunctions: true }).filter(u => u.isRead);
        const outerReads = collectVariables(functionBodyNode, { includeNestedFunctions: false }).filter(u => u.isRead);
        const outerReadKeys = new Set(outerReads.map(u => `${u.name}@${u.location}`));
        const closureReadNames = new Set(allReads.filter(u => !outerReadKeys.has(`${u.name}@${u.location}`)).map(u => u.name));
        const outerReadNames = new Set(outerReads.map(u => u.name));
        const nestedFunctionEntryNodeIds: number[] = [];
        const closureReadNamesByEntryNodeId = new Map<number, Set<string>>();

        for (let nodeId = 0; nodeId < nodePayloads.length; nodeId += 1) {
          const payload = nodePayloads[nodeId];

          if (!payload) {
            continue;
          }

          const nested = collectOxcNodes(payload as unknown as NodeValue, n => isFunctionNode(n));

          if (nested.length === 0) {
            continue;
          }

          let hasRelevantNested = false;
          const entryReadNames = new Set<string>();

          for (const nestedFunction of nested) {
            const nestedType = getNodeType(nestedFunction);

            // If a nested FunctionDeclaration is never referenced in the outer body,
            // treat its closure reads as non-executed to enable dead-store detection.
            if (nestedType === 'FunctionDeclaration' && isNodeRecord(nestedFunction)) {
              const declName = getNodeName(nestedFunction.id);

              if (declName !== null && !outerReadNames.has(declName)) {
                continue;
              }
            }

            hasRelevantNested = true;

            // Collect read names specific to this nested function for per-entry precision.
            const nestedReads = collectVariables(nestedFunction as unknown as NodeValue, { includeNestedFunctions: true }).filter(
              u => u.isRead,
            );

            for (const r of nestedReads) {
              if (closureReadNames.has(r.name)) {
                entryReadNames.add(r.name);
              }
            }
          }

          if (hasRelevantNested) {
            nestedFunctionEntryNodeIds.push(nodeId);
            closureReadNamesByEntryNodeId.set(nodeId, entryReadNames);
          }
        }

        for (let defId = 0; defId < defs.length; defId += 1) {
          if (!usedDefs.has(defId)) {
            continue;
          }

          const meta = defs[defId];

          if (meta) {
            varHasAnyUsedDef[meta.varIndex] = true;
          }
        }

        for (let defId = 0; defId < defs.length; defId += 1) {
          if (usedDefs.has(defId)) {
            continue;
          }

          const meta = defs[defId];

          if (!meta) {
            continue;
          }

          // If the variable is used via some other definition, suppress unused
          // declaration initializers to avoid noisy reports on common patterns.
          if (meta.writeKind === 'declaration' && varHasAnyUsedDef[meta.varIndex] === true) {
            continue;
          }

          // P2-4: suppress dead-store if this def reaches a nested function and the variable is read in a closure.
          let isClosureCaptured = false;

          for (const entryNodeId of nestedFunctionEntryNodeIds) {
            const entryReadNames = closureReadNamesByEntryNodeId.get(entryNodeId);

            if (!entryReadNames || !entryReadNames.has(meta.name)) {
              continue;
            }

            const reaching = reachingInByNode[entryNodeId];

            if (reaching && reaching.has(defId)) {
              isClosureCaptured = true;

              break;
            }
          }

          if (isClosureCaptured) {
            continue;
          }

          const loc = getLineColumn(file.sourceText, meta.location);
          const isOverwritten = overwrittenDefIds[defId] === true;
          const kind = isOverwritten && meta.writeKind !== 'declaration' ? 'dead-store-overwrite' : 'dead-store';
          const message =
            kind === 'dead-store-overwrite'
              ? `Variable '${meta.name}' is assigned but overwritten before being read`
              : `Variable '${meta.name}' is assigned but never read`;

          findings.push({
            kind,
            label: meta.name,
            message,
            filePath: file.filePath,
            span: {
              start: loc,
              end: {
                line: loc.line,
                column: loc.column + meta.name.length,
              },
            },
          });
        }

        if (memoryRetentionThreshold >= 1) {
          const parameterVarIndexes = new Set<number>();

          for (const binding of parameterBindings) {
            const varIndex = localIndexByName.get(binding.name);

            if (typeof varIndex === 'number') {
              parameterVarIndexes.add(varIndex);
            }
          }

          const lastReadLocationByVarIndex: number[] = Array.from({ length: localIndexByName.size }, () => -1);
          const lastReadNodeIdByVarIndex: number[] = Array.from({ length: localIndexByName.size }, () => -1);
          const lastWriteLocationByVarIndex: number[] = Array.from({ length: localIndexByName.size }, () => -1);

          for (let nodeId = 0; nodeId < nodePayloads.length; nodeId += 1) {
            const payload = nodePayloads[nodeId];

            if (!payload) {
              continue;
            }

            const usages = collectVariables(payload, { includeNestedFunctions: false });

            for (const usage of usages) {
              const varIndex = localIndexByName.get(usage.name);

              if (typeof varIndex !== 'number') {
                continue;
              }

              if (usage.isRead) {
                if (usage.location > (lastReadLocationByVarIndex[varIndex] ?? -1)) {
                  lastReadLocationByVarIndex[varIndex] = usage.location;
                  lastReadNodeIdByVarIndex[varIndex] = nodeId;
                }
              }

              if (usage.isWrite) {
                if (usage.location > (lastWriteLocationByVarIndex[varIndex] ?? -1)) {
                  lastWriteLocationByVarIndex[varIndex] = usage.location;
                }
              }
            }
          }

          const scopeEndLoc = getLineColumn(file.sourceText, node.end);

          for (let varIndex = 0; varIndex < localIndexByName.size; varIndex += 1) {
            if (parameterVarIndexes.has(varIndex)) {
              continue;
            }

            const lastReadLocRaw = lastReadLocationByVarIndex[varIndex] ?? -1;
            const lastReadNodeId = lastReadNodeIdByVarIndex[varIndex] ?? -1;
            const lastWriteLocRaw = lastWriteLocationByVarIndex[varIndex] ?? -1;
            const name = nameByVarIndex[varIndex] ?? '';

            if (name.length === 0) {
              continue;
            }

            // Ignore variables that are never read.
            if (lastReadLocRaw < 0 || lastReadNodeId < 0) {
              continue;
            }

            // If the variable is written after its last read, it likely releases the previous value.
            if (lastWriteLocRaw > lastReadLocRaw) {
              continue;
            }

            const steps = computeMinPayloadStepsToExit(cfg, nodePayloads, lastReadNodeId, exitId);

            if (steps === null || steps < memoryRetentionThreshold) {
              continue;
            }

            const lastUseLoc = getLineColumn(file.sourceText, lastReadLocRaw);

            findings.push({
              kind: 'memory-retention',
              label: name,
              message: `Variable '${name}' is last used at line ${lastUseLoc.line} but scope ends at line ${scopeEndLoc.line}. Consider nullifying or restructuring to allow GC.`,
              filePath: file.filePath,
              confidence: 0.5,
              span: {
                start: lastUseLoc,
                end: {
                  line: lastUseLoc.line,
                  column: lastUseLoc.column + name.length,
                },
              },
            });
          }
        }
      }

      if (!isNodeRecord(node)) {
        return;
      }

      const keys = Object.keys(node);

      for (const key of keys) {
        if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') {
          continue;
        }

        const value = node[key];
        const visitValue = isOxcNode(value) || Array.isArray(value) ? value : undefined;

        visit(visitValue);
      }
    };

    visit(file.program);
  }

  return findings;
};
