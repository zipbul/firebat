import type { Gildash } from '@zipbul/gildash';
import type { Function as OxcFunction, Node, Program } from 'oxc-parser';

import { GildashError } from '@zipbul/gildash';
import { buildLineOffsets, getLineColumn } from '@zipbul/gildash';
import { Visitor } from 'oxc-parser';

import type { CfgNodePayload, ParsedFile } from '../../engine/types';
import type { TemporalCouplingFinding } from '../../types';

import { normalizeFile } from '../../engine/ast/normalize-file';
import { getNodeName, isOxcNode, walkOxcTree } from '../../engine/ast/oxc-ast-utils';
import { OxcCFGBuilder } from '../../engine/cfg/cfg-builder';
import { EdgeType } from '../../engine/cfg/cfg-types';

interface AnalyzeTemporalCouplingInput {
  readonly gildash?: Gildash;
}

const createEmptyTemporalCoupling = (): ReadonlyArray<TemporalCouplingFinding> => [];

const spanForOffset = (sourceText: string, offset: number) => {
  const offsets = buildLineOffsets(sourceText);

  return {
    start: getLineColumn(offsets, Math.max(0, offset)),
    end: getLineColumn(offsets, Math.min(sourceText.length, Math.max(0, offset + 1))),
  };
};

/** Collect the set of exported function/variable names from the program. */
const collectExportedFunctionNames = (program: Node): Set<string> => {
  const names = new Set<string>();

  new Visitor({
    ExportNamedDeclaration(node) {
      const decl = node.declaration;

      if (decl !== null) {
        if (decl.type === 'FunctionDeclaration') {
          const name = getNodeName(decl.id);

          if (typeof name === 'string' && name.length > 0) {
            names.add(name);
          }
        } else if (decl.type === 'VariableDeclaration') {
          for (const declarator of decl.declarations) {
            const init = declarator.init;

            if (init === null || (init.type !== 'ArrowFunctionExpression' && init.type !== 'FunctionExpression')) {
              continue;
            }

            const name = getNodeName(declarator.id);

            if (typeof name === 'string' && name.length > 0) {
              names.add(name);
            }
          }
        }
      }

      // re-export: export { init, query }
      for (const specifier of node.specifiers) {
        const localName = getNodeName(specifier.local);

        if (typeof localName === 'string' && localName.length > 0) {
          names.add(localName);
        }
      }
    },

    ExportDefaultDeclaration(node) {
      const decl = node.declaration;

      if (decl.type !== 'FunctionDeclaration') {
        return;
      }

      const name = getNodeName(decl.id);

      if (typeof name === 'string' && name.length > 0) {
        names.add(name);
      }
    },
  }).visit(program as Program);

  return names;
};

/**
 * Try to get exported function/variable names from gildash.
 * Returns null on failure so the caller can fall back to AST walk.
 */
const collectExportedFunctionNamesFromGildash = (gildash: Gildash | undefined, relPath: string): Set<string> | null => {
  if (gildash === undefined || typeof gildash.getSymbolsByFile !== 'function') {
    return null;
  }

  try {
    const symbols = gildash.getSymbolsByFile(relPath);

    if (symbols.length === 0) {
      return null;
    }

    const names = new Set<string>();

    for (const sym of symbols) {
      if (!sym.isExported) {
        continue;
      }

      if (sym.kind === 'function' || sym.kind === 'variable') {
        names.add(sym.name);
      }
    }

    return names.size > 0 ? names : null;
  } catch (e) {
    if (e instanceof GildashError) {
      return null;
    }
    throw e;
  }
};

/** Get the enclosing exported function name, or null if not inside an exported function. */
const getEnclosingExportedFunction = (program: Node, targetOffset: number, exportedNames: Set<string>): string | null => {
  let result: string | null = null;

  walkOxcTree(program, node => {
    // FunctionDeclaration: export function foo() { ... }
    if (node.type === 'FunctionDeclaration') {
      const name = getNodeName(node.id);

      if (typeof name !== 'string' || !exportedNames.has(name)) {
        return true;
      }

      if (targetOffset >= node.start && targetOffset <= node.end) {
        result = name;

        return false;
      }
    }

    // VariableDeclarator: export const foo = () => { ... } or const foo = () => { ... } with re-export
    if (node.type === 'VariableDeclarator') {
      const name = getNodeName(node.id);

      if (typeof name !== 'string' || !exportedNames.has(name)) {
        return true;
      }

      const init = node.init;

      if (!isOxcNode(init) || (init.type !== 'ArrowFunctionExpression' && init.type !== 'FunctionExpression')) {
        return true;
      }

      if (targetOffset >= init.start && targetOffset <= init.end) {
        result = name;

        return false;
      }
    }

    return true;
  });

  return result;
};

/** Collect top-level let/var declarations from the program body. */
const collectTopLevelMutableVars = (program: Node): Array<{ name: string; offset: number }> => {
  const vars: Array<{ name: string; offset: number }> = [];

  if (program.type !== 'Program') {
    return vars;
  }

  const body = program.body;

  if (!Array.isArray(body)) {
    return vars;
  }

  for (const stmt of body) {
    if (!isOxcNode(stmt)) {
      continue;
    }

    if (stmt.type === 'VariableDeclaration') {
      const kind = stmt.kind;

      if (kind !== 'let' && kind !== 'var') {
        continue;
      }

      const declarations = stmt.declarations;

      if (!Array.isArray(declarations)) {
        continue;
      }

      for (const declarator of declarations) {
        const name = getNodeName(declarator.id);

        if (typeof name !== 'string' || name.length === 0) {
          continue;
        }

        vars.push({ name, offset: stmt.start });
      }
    }
  }

  return vars;
};

interface WriterReaderResult {
  readonly writers: ReadonlyArray<string>;
  readonly readers: ReadonlyArray<string>;
}

/**
 * Returns true when `target` binds an Identifier named `name`, descending through
 * destructuring patterns (object, array, rest, default value).
 */
const targetBindsIdentifier = (target: Node, name: string): boolean => {
  if (target.type === 'Identifier') {
    return target.name === name;
  }

  if (target.type === 'AssignmentPattern') {
    return targetBindsIdentifier(target.left, name);
  }

  if (target.type === 'RestElement') {
    return targetBindsIdentifier(target.argument, name);
  }

  if (target.type === 'ObjectPattern') {
    for (const prop of target.properties) {
      if (prop.type === 'Property') {
        if (targetBindsIdentifier(prop.value, name)) {
          return true;
        }
      } else if (prop.type === 'RestElement') {
        if (targetBindsIdentifier(prop.argument, name)) {
          return true;
        }
      }
    }

    return false;
  }

  if (target.type === 'ArrayPattern') {
    for (const elem of target.elements) {
      if (elem !== null && targetBindsIdentifier(elem, name)) {
        return true;
      }
    }
  }

  return false;
};

/**
 * Walk an assignment target and record `start:end` keys for each bound Identifier.
 * Handles plain identifiers, object/array destructuring (with nesting, rest, and
 * default values), and member expressions used as targets.
 */
const collectTargetIdentifierKeys = (target: Node | null | undefined, keys: Set<string>): void => {
  if (target === null || target === undefined) {
    return;
  }

  if (target.type === 'Identifier') {
    keys.add(`${target.start}:${target.end}`);

    return;
  }

  if (target.type === 'MemberExpression') {
    // e.g. `obj.prop = ...` — record the whole member expression's range.
    keys.add(`${target.start}:${target.end}`);

    return;
  }

  if (target.type === 'AssignmentPattern') {
    // `({a = 1} = …)` — the binding target is on the left.
    collectTargetIdentifierKeys(target.left, keys);

    return;
  }

  if (target.type === 'RestElement') {
    collectTargetIdentifierKeys(target.argument, keys);

    return;
  }

  if (target.type === 'ObjectPattern') {
    for (const prop of target.properties) {
      if (prop.type === 'Property') {
        collectTargetIdentifierKeys(prop.value, keys);
      } else if (prop.type === 'RestElement') {
        collectTargetIdentifierKeys(prop.argument, keys);
      }
    }

    return;
  }

  if (target.type === 'ArrayPattern') {
    for (const elem of target.elements) {
      if (elem !== null) {
        collectTargetIdentifierKeys(elem, keys);
      }
    }
  }
};

/** Build a Set of "start:end" keys for all write-position identifiers in the program (O(n)). */
const collectWritePositionKeys = (program: Node): Set<string> => {
  const keys = new Set<string>();

  new Visitor({
    AssignmentExpression(node) {
      collectTargetIdentifierKeys(node.left, keys);
    },

    UpdateExpression(node) {
      const argument = node.argument;

      keys.add(`${argument.start}:${argument.end}`);
    },
  }).visit(program as Program);

  return keys;
};

/** For a given variable name, find which exported functions write it and which only read it. */
const classifyExportedFunctions = (
  program: Node,
  _sourceText: string,
  varName: string,
  exportedNames: Set<string>,
  writeKeys: Set<string>,
): WriterReaderResult => {
  const writerFns = new Set<string>();
  const readerFns = new Set<string>();
  // Collect all Identifier nodes matching varName
  const identifiers: Node[] = [];

  new Visitor({
    Identifier(node) {
      if (node.name === varName) {
        identifiers.push(node);
      }
    },
  }).visit(program as Program);

  for (const idNode of identifiers) {
    const fnName = getEnclosingExportedFunction(program, idNode.start, exportedNames);

    if (fnName === null) {
      continue;
    }

    const isWrite = writeKeys.has(`${idNode.start}:${idNode.end}`);

    if (isWrite) {
      writerFns.add(fnName);
    } else {
      readerFns.add(fnName);
    }
  }

  // Remove functions that are both writer and reader from readers-only set
  const pureReaders = [...readerFns].filter(fn => !writerFns.has(fn));

  return { writers: [...writerFns], readers: pureReaders };
};

const collectStateProperties = (bodyItems: ReadonlyArray<unknown>): Array<{ name: string; offset: number }> => {
  const stateProps: Array<{ name: string; offset: number }> = [];

  for (const item of bodyItems) {
    if (!isOxcNode(item) || item.type !== 'PropertyDefinition') {
      continue;
    }

    const propName = getNodeName(item.key);

    if (typeof propName !== 'string' || propName.length === 0) {
      continue;
    }

    stateProps.push({ name: propName, offset: item.start });
  }

  return stateProps;
};

const classifyMethodAccess = (methodBody: Node, propName: string): { hasWrite: boolean; hasRead: boolean } => {
  let hasWrite = false;
  let hasRead = false;

  walkOxcTree(methodBody, node => {
    if (node.type === 'MemberExpression') {
      const object = node.object;
      const property = node.property;

      if (isOxcNode(object) && object.type === 'ThisExpression' && isOxcNode(property) && getNodeName(property) === propName) {
        hasRead = true;
      }
    }

    if (node.type === 'AssignmentExpression') {
      const left = node.left;

      if (isOxcNode(left) && left.type === 'MemberExpression') {
        const obj = left.object;
        const p = left.property;

        if (isOxcNode(obj) && obj.type === 'ThisExpression' && isOxcNode(p) && getNodeName(p) === propName) {
          hasWrite = true;
        }
      }
    }

    if (node.type === 'UpdateExpression') {
      const argument = node.argument;

      if (isOxcNode(argument) && argument.type === 'MemberExpression') {
        const obj = argument.object;
        const p = argument.property;

        if (isOxcNode(obj) && obj.type === 'ThisExpression' && isOxcNode(p) && getNodeName(p) === propName) {
          hasWrite = true;
        }
      }
    }

    return true;
  });

  return { hasWrite, hasRead };
};

const classifyMethods = (
  bodyItems: ReadonlyArray<unknown>,
  propName: string,
): { writerMethods: Set<string>; readerMethods: Set<string> } => {
  const writerMethods = new Set<string>();
  const readerMethods = new Set<string>();

  for (const item of bodyItems) {
    if (!isOxcNode(item) || item.type !== 'MethodDefinition') {
      continue;
    }

    const methodName = getNodeName(item.key);

    if (typeof methodName !== 'string' || methodName.length === 0) {
      continue;
    }

    if (methodName === 'constructor') {
      continue;
    }

    const methodBody = isOxcNode(item.value) ? item.value : null;

    if (methodBody === null) {
      continue;
    }

    const { hasWrite, hasRead } = classifyMethodAccess(methodBody, propName);

    if (hasWrite) {
      writerMethods.add(methodName);
    }

    if (hasRead && !hasWrite) {
      readerMethods.add(methodName);
    }
  }

  return { writerMethods, readerMethods };
};

/** Collect class state properties and classify methods as writers/readers. */
const analyzeClassTemporalCoupling = (
  program: Node,
  sourceText: string,
  rel: string,
  gildash?: Gildash,
): TemporalCouplingFinding[] => {
  const findings: TemporalCouplingFinding[] = [];
  const classes: Node[] = [];

  new Visitor({
    ClassDeclaration(node) {
      classes.push(node);
    },
    ClassExpression(node) {
      classes.push(node);
    },
  }).visit(program as Program);

  for (const classNode of classes) {
    if (classNode.type !== 'ClassDeclaration' && classNode.type !== 'ClassExpression') {
      continue;
    }

    // Extract class name — anonymous classes cannot be matched via gildash
    const className = typeof getNodeName(classNode.id) === 'string' ? (getNodeName(classNode.id) as string) : null;
    const classBody = classNode.body;

    if (!isOxcNode(classBody) || classBody.type !== 'ClassBody') {
      continue;
    }

    const bodyItems = classBody.body;

    if (!Array.isArray(bodyItems)) {
      continue;
    }

    // 1. Collect state properties (PropertyDefinition with initializer)
    const stateProps = collectStateProperties(bodyItems);

    // 2. For each state property, classify methods as writers/readers
    for (const prop of stateProps) {
      const { writerMethods, readerMethods } = classifyMethods(bodyItems, prop.name);

      // Phase 6: dead writer 제외 — named class method 내 unreachable write는 writer가 아님
      // anonymous class(className === null)는 findFunctionBody로 찾을 수 없으므로 건너뜀
      if (className !== null) {
        for (const methodName of [...writerMethods]) {
          const qualifiedMethod = `${className}.${methodName}`;

          if (!isWriterReachable(program, qualifiedMethod, prop.name, true)) {
            writerMethods.delete(methodName);
          }
        }
      }

      if (writerMethods.size > 0 && readerMethods.size > 0) {
        // gildash 억제 검사: named class만 대상 (anonymous class 제외)
        if (gildash !== undefined && className !== null) {
          const qualifiedWriters = [...writerMethods].map(m => `${className}.${m}`);
          const qualifiedReaders = [...readerMethods].map(m => `${className}.${m}`);

          try {
            if (shouldSuppressByCallGraph(gildash, rel, qualifiedWriters, qualifiedReaders)) {
              continue;
            }
          } catch (e) {
            if (!(e instanceof GildashError)) {
              throw e;
            }
            // gildash 에러 → AST-only fallback
          }
        }

        for (const readerMethodName of readerMethods) {
          // Phase 5: guard 패턴 — class reader가 self-protecting이면 finding 억제
          if (
            isReaderSelfProtecting(
              program,
              className !== null ? `${className}.${readerMethodName}` : readerMethodName,
              prop.name,
              true,
            )
          ) {
            continue;
          }

          findings.push({
            kind: 'temporal-coupling',
            file: rel,
            span: spanForOffset(sourceText, prop.offset),
            state: prop.name,
            writers: writerMethods.size,
            readers: readerMethods.size,
          });
        }
      }
    }
  }

  return findings;
};

interface CallerKey {
  readonly srcFilePath: string;
  readonly srcSymbolName: string | null;
}

/**
 * Find the CFG node IDs whose payload contains a CallExpression with a callee name
 * matching one of the targetNames.
 */
const findCallNodeIds = (nodePayloads: ReadonlyArray<CfgNodePayload | null>, targetNames: ReadonlySet<string>): number[] => {
  const ids: number[] = [];

  for (let i = 0; i < nodePayloads.length; i++) {
    const payload = nodePayloads[i];

    if (payload === null || payload === undefined) {
      continue;
    }

    const callNodes: Node[] = [];

    walkOxcTree(payload as Node, n => {
      if (n.type === 'CallExpression') {
        callNodes.push(n);
      }

      return true;
    });

    for (const callNode of callNodes) {
      if (callNode.type !== 'CallExpression') {
        continue;
      }

      const callee = callNode.callee;

      if (!isOxcNode(callee)) {
        continue;
      }

      let callName: string | null = null;

      if (callee.type === 'Identifier') {
        callName = getNodeName(callee);
      } else if (callee.type === 'MemberExpression') {
        callName = getNodeName(callee.property);
      }

      if (callName === null || !targetNames.has(callName)) {
        continue;
      }

      ids.push(i);

      break;
    }
  }

  return ids;
};

/**
 * BFS from entryId forbidding writerNodeIds. Returns true if readerNodeId is unreachable
 * (meaning all paths to reader go through at least one writer — set domination).
 */
const writerSetDominatesReader = (
  adj: Int32Array[],
  entryId: number,
  writerNodeIds: ReadonlyArray<number>,
  readerNodeId: number,
): boolean => {
  const writerSet = new Set(writerNodeIds);

  // If entry itself is a writer or reader, handle edge cases
  if (writerSet.has(entryId)) {
    return true;
  }

  if (readerNodeId === entryId) {
    return false;
  }

  const visited = new Set<number>();
  const queue: number[] = [entryId];

  visited.add(entryId);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = adj[current];

    if (neighbors === undefined) {
      continue;
    }

    for (const neighbor of neighbors) {
      if (neighbor === readerNodeId) {
        return false;
      } // reached reader without going through all writers

      if (writerSet.has(neighbor)) {
        continue;
      } // skip writer nodes

      if (visited.has(neighbor)) {
        continue;
      }

      visited.add(neighbor);
      queue.push(neighbor);
    }
  }

  return true; // reader never reached → writers dominate
};

/**
 * Check if there is an exception-edge bypass: remove normal edges from writer nodes,
 * keep only exception edges from writers, then BFS from entry to reader.
 * Returns true if reader is reachable via exception paths (suppression not safe).
 */
const exceptionBypassExists = (
  edges: Int32Array,
  nodeCount: number,
  entryId: number,
  writerNodeIds: ReadonlyArray<number>,
  readerNodeId: number,
): boolean => {
  const writerSet = new Set(writerNodeIds);
  // Build a modified adjacency: for writer nodes, only keep exception edges outgoing;
  // for non-writer nodes, keep all edges.
  const modAdj: number[][] = Array.from({ length: nodeCount }, () => []);
  const edgeCount = edges.length / 3;

  for (let i = 0; i < edgeCount; i++) {
    const offset = i * 3;
    const from = edges[offset];
    const to = edges[offset + 1];
    const type = edges[offset + 2];

    if (from === undefined || to === undefined || type === undefined) {
      continue;
    }

    if (writerSet.has(from)) {
      // Only allow exception edges out of writer nodes
      if (type === EdgeType.Exception) {
        modAdj[from]?.push(to);
      }
    } else {
      modAdj[from]?.push(to);
    }
  }

  // BFS from entry to reader in modified graph
  const visited = new Set<number>();
  const queue: number[] = [entryId];

  visited.add(entryId);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = modAdj[current];

    if (neighbors === undefined) {
      continue;
    }

    for (const neighbor of neighbors) {
      if (neighbor === readerNodeId) {
        return true;
      }

      if (visited.has(neighbor)) {
        continue;
      }

      visited.add(neighbor);
      queue.push(neighbor);
    }
  }

  return false;
};

/** Find a function body node for the given symbol name in the program. */
const findFunctionBody = (program: Node, symbolName: string): Node | null => {
  let result: Node | null = null;
  // Handle ClassName.method format
  const dotIndex = symbolName.indexOf('.');

  if (dotIndex !== -1) {
    const className = symbolName.slice(0, dotIndex);
    const methodName = symbolName.slice(dotIndex + 1);

    walkOxcTree(program, node => {
      if (result !== null) {
        return false;
      }

      if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
        const name = getNodeName(node.id);

        if (name !== className) {
          return true;
        }

        const classBody = node.body;

        if (!isOxcNode(classBody) || classBody.type !== 'ClassBody') {
          return false;
        }

        const bodyItems = classBody.body;

        if (!Array.isArray(bodyItems)) {
          return false;
        }

        for (const item of bodyItems) {
          if (!isOxcNode(item) || item.type !== 'MethodDefinition') {
            continue;
          }

          const mName = getNodeName(item.key);

          if (mName !== methodName) {
            continue;
          }

          const methodValue = item.value;

          if (isOxcNode(methodValue)) {
            result = methodValue;
          }

          return false;
        }

        return false;
      }

      return true;
    });
  } else {
    // Plain function name
    walkOxcTree(program, node => {
      if (result !== null) {
        return false;
      }

      // FunctionDeclaration: function foo() {}
      if (node.type === 'FunctionDeclaration') {
        if (getNodeName(node.id) === symbolName) {
          result = node as Node;

          return false;
        }
      }

      // VariableDeclarator: const foo = () => {} or function() {}
      if (node.type === 'VariableDeclarator') {
        if (getNodeName(node.id) === symbolName) {
          const init = node.init;

          if (isOxcNode(init) && (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression')) {
            result = init;

            return false;
          }
        }
      }

      return true;
    });
  }

  return result;
};

/** Check whether a node (payload or AST subtree) references the given state name. */
const nodeReferencesState = (node: Node, stateName: string, isClassProp: boolean): boolean => {
  let found = false;

  walkOxcTree(node, n => {
    if (found) {
      return false;
    }

    if (isClassProp) {
      // this.stateName — MemberExpression(ThisExpression, Identifier === stateName)
      if (n.type === 'MemberExpression') {
        const object = n.object;
        const property = n.property;

        if (isOxcNode(object) && object.type === 'ThisExpression' && isOxcNode(property) && getNodeName(property) === stateName) {
          found = true;

          return false;
        }
      }
    } else if (n.type === 'Identifier' && getNodeName(n) === stateName) {
      // module-scope: plain Identifier === stateName
      found = true;

      return false;
    }

    return true;
  });

  return found;
};

/**
 * Check if a guard IfStatement's consequent is an early-exit (ThrowStatement or ReturnStatement).
 */
const isEarlyExit = (node: Node): boolean => {
  if (node.type === 'ThrowStatement' || node.type === 'ReturnStatement') {
    return true;
  }

  // BlockStatement with single ThrowStatement/ReturnStatement
  if (node.type === 'BlockStatement') {
    const body = node.body;

    if (!Array.isArray(body)) {
      return false;
    }

    if (body.length === 1) {
      const first = body[0];

      return first !== undefined && (first.type === 'ThrowStatement' || first.type === 'ReturnStatement');
    }
  }

  return false;
};

/**
 * Returns true if the reader function is self-protecting:
 * all state accesses in the reader body are dominated by a guard condition
 * that references stateName and has an early-exit consequent.
 */
const isReaderSelfProtecting = (program: Node, readerName: string, stateName: string, isClassProp: boolean): boolean => {
  const funcNode = findFunctionBody(program, readerName);

  if (funcNode === null) {
    return false;
  }

  const funcBodyRaw = (funcNode as OxcFunction).body;

  if (funcBodyRaw === null || funcBodyRaw === undefined) {
    return false;
  }

  const built = OxcCFGBuilder.build(funcBodyRaw);
  const { cfg, entryId, nodePayloads } = built;
  const adj = cfg.buildAdjacency('forward');
  // Find guard condition node IDs:
  // nodePayloads[i] is the IfStatement test expression when an IfStatement is processed.
  // We need to identify which CFG node IDs correspond to guard conditions.
  // Strategy: walk the reader body AST to collect IfStatement test nodes (by start offset).
  // Then match those offsets against nodePayloads.
  const guardConditionOffsets = new Set<number>();

  walkOxcTree(funcBodyRaw, n => {
    if (n.type === 'IfStatement') {
      const testNode = n.test;
      const consequentNode = n.consequent;

      if (!isOxcNode(testNode) || !isOxcNode(consequentNode)) {
        return true;
      }

      // Check: test references stateName
      if (!nodeReferencesState(testNode, stateName, isClassProp)) {
        return true;
      }

      // Check: consequent is early exit
      if (!isEarlyExit(consequentNode)) {
        return true;
      }

      // This is a guard — record test node offset
      guardConditionOffsets.add(testNode.start);
    }

    return true;
  });

  if (guardConditionOffsets.size === 0) {
    return false;
  }

  // Find CFG node IDs for guard conditions (match by payload start offset)
  const guardNodeIds: number[] = [];

  for (let i = 0; i < nodePayloads.length; i++) {
    const payload = nodePayloads[i];

    if (payload === null || payload === undefined) {
      continue;
    }

    // payload for an IfStatement condition is the test expression node
    if (isOxcNode(payload as Node) && guardConditionOffsets.has((payload as Node).start)) {
      guardNodeIds.push(i);
    }
  }

  if (guardNodeIds.length === 0) {
    return false;
  }

  // Find state access node IDs (nodes that reference stateName, excluding guard condition nodes)
  const guardNodeIdSet = new Set(guardNodeIds);
  const stateAccessNodeIds: number[] = [];

  for (let i = 0; i < nodePayloads.length; i++) {
    if (guardNodeIdSet.has(i)) {
      continue;
    }

    const payload = nodePayloads[i];

    if (payload === null || payload === undefined) {
      continue;
    }

    // Check if payload references stateName
    const payloadNode = isOxcNode(payload as Node) ? (payload as Node) : null;
    const payloadArr = Array.isArray(payload) ? (payload as ReadonlyArray<Node>) : null;

    if (payloadNode !== null && nodeReferencesState(payloadNode, stateName, isClassProp)) {
      stateAccessNodeIds.push(i);
    } else if (payloadArr !== null) {
      for (const n of payloadArr) {
        if (!nodeReferencesState(n, stateName, isClassProp)) {
          continue;
        }

        stateAccessNodeIds.push(i);

        break;
      }
    }
  }

  // If no state accesses found (shouldn't happen but be safe), not self-protecting
  if (stateAccessNodeIds.length === 0) {
    return false;
  }

  // Check: guard condition nodes (as a set) dominate all state access nodes
  for (const stateNodeId of stateAccessNodeIds) {
    if (!writerSetDominatesReader(adj, entryId, guardNodeIds, stateNodeId)) {
      return false;
    }
  }

  return true;
};

/**
 * Verify caller order using CFG dominator analysis.
 *
 * For each caller: build CFG of the caller function, find CFG node IDs containing
 * writer/reader calls, then check if all writers set-dominate the reader and no
 * exception bypass exists.
 *
 * Returns true (allow suppression) only when all callers satisfy domination.
 */
const verifyCallerOrderByCfg = (
  gildash: Gildash,
  writerNames: ReadonlyArray<string>,
  readerNames: ReadonlyArray<string>,
  callerKeys: ReadonlyArray<CallerKey>,
): boolean => {
  if (typeof gildash.getParsedAst !== 'function') {
    // gildash does not support AST retrieval → skip Phase 4, trust Phase 2 result
    return true;
  }

  // Extract bare names (strip ClassName. prefix) for call-site matching
  const writerBareNames = new Set(writerNames.map(n => (n.includes('.') ? n.slice(n.indexOf('.') + 1) : n)));
  const readerBareNames = new Set(readerNames.map(n => (n.includes('.') ? n.slice(n.indexOf('.') + 1) : n)));

  for (const caller of callerKeys) {
    if (caller.srcSymbolName === null) {
      continue;
    }

    const parsed = gildash.getParsedAst(caller.srcFilePath);

    if (parsed === undefined || parsed === null) {
      return false;
    }

    const funcNode = findFunctionBody(parsed.program, caller.srcSymbolName);

    if (funcNode === null) {
      return false;
    }

    const funcBodyRaw = (funcNode as OxcFunction).body;

    if (funcBodyRaw === null || funcBodyRaw === undefined) {
      return false;
    }

    const built = OxcCFGBuilder.build(funcBodyRaw);
    const { cfg, entryId, nodePayloads } = built;
    const writerNodeIds = findCallNodeIds(nodePayloads, writerBareNames);
    const readerNodeIds = findCallNodeIds(nodePayloads, readerBareNames);

    if (writerNodeIds.length === 0 || readerNodeIds.length === 0) {
      return false;
    }

    const adj = cfg.buildAdjacency('forward');
    const edges = cfg.getEdges();
    const nodeCount = cfg.nodeCount;

    for (const readerNodeId of readerNodeIds) {
      // Check: do all writer nodes (as a set) dominate this reader?
      if (!writerSetDominatesReader(adj, entryId, writerNodeIds, readerNodeId)) {
        return false; // reader reachable without going through all writers
      }

      // Check: is there an exception edge bypass allowing reader execution even if writer throws?
      if (exceptionBypassExists(edges, nodeCount, entryId, writerNodeIds, readerNodeId)) {
        return false; // exception path reaches reader without writer completing
      }
    }
  }

  return true;
};

/**
 * Returns true if the write to stateName inside writerName is reachable from the function entry.
 * Dead writes (after return/throw) are considered unreachable → not a real writer.
 */
const isWriterReachable = (program: Node, writerName: string, stateName: string, isClassProp: boolean): boolean => {
  const funcNode = findFunctionBody(program, writerName);

  if (funcNode === null) {
    return false;
  }

  const funcBodyRaw = (funcNode as OxcFunction).body;

  if (funcBodyRaw === null || funcBodyRaw === undefined) {
    return false;
  }

  const built = OxcCFGBuilder.build(funcBodyRaw);
  const { cfg, entryId, nodePayloads } = built;
  const adj = cfg.buildAdjacency('forward');
  // Find CFG node IDs that contain a write to stateName
  const writeNodeIds: number[] = [];

  for (let i = 0; i < nodePayloads.length; i++) {
    const payload = nodePayloads[i];

    if (payload === null || payload === undefined) {
      continue;
    }

    // Check if payload contains an AssignmentExpression or UpdateExpression targeting stateName
    let hasWrite = false;

    const checkNode = (n: Node) => {
      if (hasWrite) {
        return false;
      }

      if (isClassProp) {
        // this.stateName = ...
        if (n.type === 'AssignmentExpression') {
          const left = n.left;

          if (isOxcNode(left) && left.type === 'MemberExpression') {
            const obj = left.object;
            const p = left.property;

            if (isOxcNode(obj) && obj.type === 'ThisExpression' && isOxcNode(p) && getNodeName(p) === stateName) {
              hasWrite = true;

              return false;
            }
          }
        }

        // this.stateName++ / --this.stateName
        if (n.type === 'UpdateExpression') {
          const argument = n.argument;

          if (isOxcNode(argument) && argument.type === 'MemberExpression') {
            const obj = argument.object;
            const p = argument.property;

            if (isOxcNode(obj) && obj.type === 'ThisExpression' && isOxcNode(p) && getNodeName(p) === stateName) {
              hasWrite = true;

              return false;
            }
          }
        }
      } else {
        // stateName = ... (also handles `({stateName} = …)` and `[stateName] = …`)
        if (n.type === 'AssignmentExpression') {
          const left = n.left;

          if (isOxcNode(left) && targetBindsIdentifier(left, stateName)) {
            hasWrite = true;

            return false;
          }
        }

        // stateName++ or ++stateName
        if (n.type === 'UpdateExpression') {
          const argument = n.argument;

          if (isOxcNode(argument) && argument.type === 'Identifier' && getNodeName(argument) === stateName) {
            hasWrite = true;

            return false;
          }
        }
      }

      return true;
    };

    if (isOxcNode(payload as Node)) {
      walkOxcTree(payload as Node, checkNode);
    } else if (Array.isArray(payload)) {
      for (const n of payload as ReadonlyArray<Node>) {
        walkOxcTree(n, checkNode);

        if (hasWrite) {
          break;
        }
      }
    }

    if (hasWrite) {
      writeNodeIds.push(i);
    }
  }

  // If no write nodes found in CFG, treat as not a writer (no actual write)
  if (writeNodeIds.length === 0) {
    return false;
  }

  // BFS from entryId: check if any writeNodeId is reachable
  const visited = new Set<number>();
  const queue: number[] = [entryId];

  visited.add(entryId);

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (writeNodeIds.includes(current)) {
      return true;
    }

    const neighbors = adj[current];

    if (neighbors === undefined) {
      continue;
    }

    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) {
        continue;
      }

      visited.add(neighbor);
      queue.push(neighbor);
    }
  }

  return false;
};

/**
 * Returns true if every caller of every reader also calls at least one writer,
 * meaning temporal coupling is handled correctly at the call site.
 *
 * relPath: normalizeFile result (relative path, e.g. "src/a.ts")
 * writerNames: function/method names that write the shared state
 * readerNames: function/method names that only read the shared state
 */
const shouldSuppressByCallGraph = (
  gildash: Gildash,
  relPath: string,
  writerNames: ReadonlyArray<string>,
  readerNames: ReadonlyArray<string>,
): boolean => {
  // Pre-fetch callers of all writers (dstFilePath+dstSymbolName keyed lookup)
  // key: `${srcFilePath}:${srcSymbolName}`
  const writerCallerSet = new Set<string>();
  const callerKeys: CallerKey[] = [];

  for (const writer of writerNames) {
    const writerCallers = gildash.searchRelations({ type: 'calls', dstFilePath: relPath, dstSymbolName: writer });

    for (const wc of writerCallers) {
      writerCallerSet.add(`${wc.srcFilePath}:${wc.srcSymbolName ?? ''}`);
    }
  }

  for (const reader of readerNames) {
    const readerCallers = gildash.searchRelations({ type: 'calls', dstFilePath: relPath, dstSymbolName: reader });

    // If reader has no callers at all, cannot suppress
    if (readerCallers.length === 0) {
      return false;
    }

    for (const rc of readerCallers) {
      const callerKey = `${rc.srcFilePath}:${rc.srcSymbolName ?? ''}`;

      if (!writerCallerSet.has(callerKey)) {
        return false;
      }

      callerKeys.push({ srcFilePath: rc.srcFilePath, srcSymbolName: rc.srcSymbolName ?? null });
    }
  }

  // Phase 4: verify caller order via CFG dominator
  return verifyCallerOrderByCfg(gildash, writerNames, readerNames, callerKeys);
};

const analyzeTemporalCoupling = (
  files: ReadonlyArray<ParsedFile>,
  input?: AnalyzeTemporalCouplingInput,
): ReadonlyArray<TemporalCouplingFinding> => {
  if (files.length === 0) {
    return createEmptyTemporalCoupling();
  }

  const findings: TemporalCouplingFinding[] = [];

  for (const file of files) {
    if (file.errors.length > 0) {
      continue;
    }

    const rel = normalizeFile(file.filePath);

    if (!rel.endsWith('.ts')) {
      continue;
    }

    // Pattern 1: module-scope let/var variables shared across exported functions
    const mutableVars = collectTopLevelMutableVars(file.program as Node);
    const exportedNames =
      collectExportedFunctionNamesFromGildash(input?.gildash, rel) ?? collectExportedFunctionNames(file.program as Node);
    const writeKeys = collectWritePositionKeys(file.program as Node);

    for (const { name, offset } of mutableVars) {
      const { writers: rawWriters, readers } = classifyExportedFunctions(
        file.program as Node,
        file.sourceText,
        name,
        exportedNames,
        writeKeys,
      );
      // Phase 6: dead writer 제외 — unreachable write는 writer가 아님
      const writers = rawWriters.filter(w => isWriterReachable(file.program as Node, w, name, false));

      if (writers.length === 0 || readers.length === 0) {
        continue;
      }

      // gildash 억제 검사
      if (input?.gildash !== undefined) {
        try {
          if (shouldSuppressByCallGraph(input.gildash, rel, writers, readers)) {
            continue;
          }
        } catch (e) {
          if (!(e instanceof GildashError)) {
            throw e;
          }
          // gildash 에러 → AST-only fallback
        }
      }

      for (const readerName of readers) {
        // Phase 5: guard 패턴 — reader가 self-protecting이면 finding 억제
        if (isReaderSelfProtecting(file.program as Node, readerName, name, false)) {
          continue;
        }

        findings.push({
          kind: 'temporal-coupling',
          file: rel,
          span: spanForOffset(file.sourceText, offset),
          state: name,
          writers: writers.length,
          readers: readers.length,
        });
      }
    }

    // Pattern 2: class state properties with writer/reader method split
    findings.push(...analyzeClassTemporalCoupling(file.program as Node, file.sourceText, rel, input?.gildash));
  }

  return findings;
};

export { analyzeTemporalCoupling, createEmptyTemporalCoupling };
