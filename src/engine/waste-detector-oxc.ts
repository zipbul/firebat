import type { Node } from 'oxc-parser';

import type { WasteFinding } from '../types';
import type { BitSet, DefMeta, FunctionBodyAnalysis, ParsedFile } from './types';

import { OxcCFGBuilder } from './cfg-builder';
import { createBitSet, equalsBitSet, intersectBitSet, subtractBitSet, unionBitSet } from './dataflow';
import { getNodeName, getNodeType, isFunctionNode, isNodeRecord, isOxcNode, isOxcNodeArray } from './oxc-ast-utils';
import { getLineColumn } from './source-position';
import { collectVariables } from './variable-collector';

const collectLocalVarIndexes = (functionNode: Node): Map<string, number> => {
  const names = new Set<string>();
  const paramsValue = isNodeRecord(functionNode) ? functionNode.params : undefined;
  const params = isOxcNodeArray(paramsValue) ? paramsValue : [];

  for (const param of params) {
    if (isOxcNode(param) && getNodeType(param) === 'Identifier') {
      const name = getNodeName(param);

      if (name !== null) {
        names.add(name);
      }
    }
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
): FunctionBodyAnalysis => {
  const cfgBuilder = new OxcCFGBuilder();
  const built = cfgBuilder.buildFunctionBody(bodyNode);
  const nodeCount = built.cfg.nodeCount;
  const nodePayloads = built.nodePayloads;
  const defsByVarIndex: number[][] = Array.from({ length: localIndexByName.size }, () => []);
  const defMetaById: DefMeta[] = [];
  const genDefIdsByNode: number[][] = Array.from({ length: nodeCount }, () => []);
  const useVarIndexesByNode: number[][] = Array.from({ length: nodeCount }, () => []);
  const writeVarIndexesByNode: number[][] = Array.from({ length: nodeCount }, () => []);

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
  };
};

export const detectWasteOxc = (files: ParsedFile[]): WasteFinding[] => {
  const findings: WasteFinding[] = [];

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

        if (localIndexByName.size === 0) {
          return;
        }

        const analysis = analyzeFunctionBody(functionBodyNode, localIndexByName);
        const defs = analysis.defs;
        const usedDefs = analysis.usedDefs;
        const overwrittenDefIds = analysis.overwrittenDefIds;
        const varHasAnyUsedDef: boolean[] = Array.from({ length: localIndexByName.size }, () => false);

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

          const loc = getLineColumn(file.sourceText, meta.location);
          const isOverwritten = overwrittenDefIds[defId] === true;
          const kind = isOverwritten && meta.writeKind !== 'declaration' ? 'dead-store-overwrite' : 'dead-store';
          const message = kind === 'dead-store-overwrite'
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