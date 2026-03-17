import type { Node } from 'oxc-parser';

import type { BitSet, ParsedFile } from '../../engine/types';
import type { VariableLifetimeFinding } from '../../types';

import { collectFunctionNodes, isNodeRecord, isOxcNode } from '../../engine/ast/oxc-ast-utils';
import { normalizeFile } from '../../engine/ast/normalize-file';
import { intersectBitSet } from '../../engine/dataflow/dataflow';
import { analyzeFunctionBody, collectLocalVarIndexes, collectParameterBindings } from '../../engine/dataflow/reaching-defs';
import { getLineColumn } from '../../engine/source-position';

const createEmptyVariableLifetime = (): ReadonlyArray<VariableLifetimeFinding> => [];

interface AnalyzeVariableLifetimeOptions {
  readonly maxLifetimeLines: number;
}

const payloadOffset = (payload: Node | ReadonlyArray<Node> | null): number => {
  if (payload === null) {
    return -1;
  }

  if (Array.isArray(payload)) {
    const first = (payload as ReadonlyArray<Node>)[0];

    return first !== undefined ? first.start : -1;
  }

  return (payload as Node).start;
};

const analyzeVariableLifetime = (
  files: ReadonlyArray<ParsedFile>,
  options: AnalyzeVariableLifetimeOptions,
): ReadonlyArray<VariableLifetimeFinding> => {
  if (files.length === 0) {
    return createEmptyVariableLifetime();
  }

  const maxLifetimeLines = Math.max(0, Math.floor(options.maxLifetimeLines));
  const findings: VariableLifetimeFinding[] = [];

  for (const file of files) {
    if (file.errors.length > 0) {
      continue;
    }

    const rel = normalizeFile(file.filePath);

    if (!rel.endsWith('.ts')) {
      continue;
    }

    const functionNodes = collectFunctionNodes(file.program);

    for (const functionNode of functionNodes) {
      const localIndexByName = collectLocalVarIndexes(functionNode);

      if (localIndexByName.size === 0) {
        continue;
      }

      const paramBindings = collectParameterBindings(functionNode);
      const bodyValue = isNodeRecord(functionNode) ? functionNode.body : undefined;
      const bodyNode = isOxcNode(bodyValue) || Array.isArray(bodyValue) ? bodyValue : undefined;

      if (bodyNode === undefined) {
        continue;
      }

      const analysis = analyzeFunctionBody(bodyNode, localIndexByName, paramBindings);
      const { defs, reachingInByNode, useVarIndexesByNode, nodePayloads, defsOfVar } = analysis;

      // Compute last use offset for each defId via reaching definitions.
      const lastUseOffsetByDefId = new Map<number, number>();

      for (let cfgNodeId = 0; cfgNodeId < nodePayloads.length; cfgNodeId += 1) {
        const reachingIn = reachingInByNode[cfgNodeId];
        const useVarIndexes = useVarIndexesByNode[cfgNodeId];

        if (!reachingIn || !useVarIndexes || useVarIndexes.length === 0) {
          continue;
        }

        const payload = nodePayloads[cfgNodeId];

        if (payload === null || payload === undefined) {
          continue;
        }

        const useOffset = payloadOffset(payload);

        if (useOffset < 0) {
          continue;
        }

        for (const varIndex of useVarIndexes) {
          const varDefs = defsOfVar[varIndex] as BitSet | undefined;

          if (!varDefs) {
            continue;
          }

          const reachingDefs = intersectBitSet(reachingIn, varDefs);
          const defIds = reachingDefs.array();

          for (const defId of defIds) {
            const existing = lastUseOffsetByDefId.get(defId);

            if (existing === undefined || useOffset > existing) {
              lastUseOffsetByDefId.set(defId, useOffset);
            }
          }
        }
      }

      // Generate findings for long-lived definitions.
      const longLived: Array<{
        readonly variable: string;
        readonly defOffset: number;
        readonly lastUseOffset: number;
        readonly lifetimeLines: number;
      }> = [];

      for (const [defId, lastUseOffset] of lastUseOffsetByDefId) {
        const defMeta = defs[defId];

        if (!defMeta) {
          continue;
        }

        const defLoc = getLineColumn(file.sourceText, defMeta.location);
        const useLoc = getLineColumn(file.sourceText, lastUseOffset);
        const lifetime = useLoc.line - defLoc.line;

        if (lifetime > maxLifetimeLines) {
          longLived.push({
            variable: defMeta.name,
            defOffset: defMeta.location,
            lastUseOffset,
            lifetimeLines: lifetime,
          });
        }
      }

      const contextBurden = longLived.length;

      for (const item of longLived) {
        const start = getLineColumn(file.sourceText, item.defOffset);
        const end = getLineColumn(file.sourceText, item.lastUseOffset);

        findings.push({
          kind: 'variable-lifetime',
          file: rel,
          span: { start, end },
          variable: item.variable,
          lifetimeLines: item.lifetimeLines,
          contextBurden,
        });
      }
    }
  }

  return findings;
};

export { analyzeVariableLifetime, createEmptyVariableLifetime };
