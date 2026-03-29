import type { Node } from 'oxc-parser';

import type { WasteFinding } from '../types';
import type { ParsedFile } from './types';

import {
  collectOxcNodes,
  getNodeName,
  getNodeType,
  isFunctionNode,
  isNodeRecord,
  isOxcNode,
} from './ast/oxc-ast-utils';
import { buildLineOffsets, getLineColumn } from '@zipbul/gildash';
import { collectVariables } from './dataflow/variable-collector';
import { analyzeFunctionBody, collectLocalVarIndexes, collectParameterBindings } from './dataflow/reaching-defs';

export const detectWasteOxc = (files: ParsedFile[]): WasteFinding[] => {
  const findings: WasteFinding[] = [];

  if (!Array.isArray(files)) {
    return [];
  }

  for (const file of files) {
    if (file.errors.length > 0) {
      continue;
    }

    const lineOffsets = buildLineOffsets(file.sourceText);

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

        if (localIndexByName.size > 0) {
          const analysis = analyzeFunctionBody(functionBodyNode, localIndexByName, parameterBindings);
          const defs = analysis.defs;
          const usedDefs = analysis.usedDefs;
          const overwrittenDefIds = analysis.overwrittenDefIds;
          const reachingInByNode = analysis.reachingInByNode;
          const nodePayloads = analysis.nodePayloads;
          const varHasAnyUsedDef: boolean[] = Array.from({ length: localIndexByName.size }, () => false);
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

            const nested = collectOxcNodes(payload, n => isFunctionNode(n));

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
              const nestedReads = collectVariables(nestedFunction, { includeNestedFunctions: true }).filter(
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

            // Skip variables with '_' prefix (intentionally ignored by convention).
            if (meta.name.startsWith('_')) {
              continue;
            }

            const loc = getLineColumn(lineOffsets, meta.location);
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
        } // end if (localIndexByName.size > 0)
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
