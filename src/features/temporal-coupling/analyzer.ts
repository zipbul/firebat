import type { Node } from 'oxc-parser';

import type { Gildash } from '@zipbul/gildash';

import type { ParsedFile } from '../../engine/types';
import type { TemporalCouplingFinding } from '../../types';

import { collectOxcNodes, getNodeName, isNodeRecord, isOxcNode, walkOxcTree } from '../../engine/ast/oxc-ast-utils';
import { normalizeFile } from '../../engine/ast/normalize-file';
import { getLineColumn } from '../../engine/source-position';

interface AnalyzeTemporalCouplingInput {
  readonly gildash?: Gildash;
}

const createEmptyTemporalCoupling = (): ReadonlyArray<TemporalCouplingFinding> => [];

const spanForOffset = (sourceText: string, offset: number) => {
  const start = getLineColumn(sourceText, Math.max(0, offset));
  const end = getLineColumn(sourceText, Math.min(sourceText.length, Math.max(0, offset + 1)));

  return { start, end };
};

/** Collect the set of exported function/variable names from the program. */
const collectExportedFunctionNames = (program: Node): Set<string> => {
  const names = new Set<string>();

  walkOxcTree(program, node => {
    if (node.type === 'ExportNamedDeclaration' && isNodeRecord(node)) {
      const decl = node.declaration;

      if (isOxcNode(decl) && isNodeRecord(decl)) {
        if (decl.type === 'FunctionDeclaration') {
          const name = getNodeName(decl.id);

          if (typeof name === 'string' && name.length > 0) {
            names.add(name);
          }
        } else if (decl.type === 'VariableDeclaration') {
          const declarations = (decl as any).declarations;

          if (Array.isArray(declarations)) {
            for (const declarator of declarations) {
              if (isOxcNode(declarator) && isNodeRecord(declarator)) {
                const init = declarator.init;

                if (
                  isOxcNode(init) &&
                  (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression')
                ) {
                  const name = getNodeName(declarator.id);

                  if (typeof name === 'string' && name.length > 0) {
                    names.add(name);
                  }
                }
              }
            }
          }
        }
      }

      // re-export: export { init, query }
      const specifiers = (node as any).specifiers;

      if (Array.isArray(specifiers)) {
        for (const specifier of specifiers) {
          if (isOxcNode(specifier) && isNodeRecord(specifier)) {
            const localName = getNodeName(specifier.local);

            if (typeof localName === 'string' && localName.length > 0) {
              names.add(localName);
            }
          }
        }
      }
    }

    if (node.type === 'ExportDefaultDeclaration' && isNodeRecord(node)) {
      const decl = node.declaration;

      if (isOxcNode(decl) && decl.type === 'FunctionDeclaration' && isNodeRecord(decl)) {
        const name = getNodeName(decl.id);

        if (typeof name === 'string' && name.length > 0) {
          names.add(name);
        }
      }
    }

    return true;
  });

  return names;
};

/** Get the enclosing exported function name, or null if not inside an exported function. */
const getEnclosingExportedFunction = (program: Node, targetOffset: number, exportedNames: Set<string>): string | null => {
  let result: string | null = null;

  walkOxcTree(program, node => {
    // FunctionDeclaration: export function foo() { ... }
    if (node.type === 'FunctionDeclaration' && isNodeRecord(node)) {
      const name = getNodeName(node.id);

      if (typeof name === 'string' && exportedNames.has(name)) {
        if (targetOffset >= node.start && targetOffset <= node.end) {
          result = name;

          return false;
        }
      }
    }

    // VariableDeclarator: export const foo = () => { ... } or const foo = () => { ... } with re-export
    if (node.type === 'VariableDeclarator' && isNodeRecord(node)) {
      const name = getNodeName(node.id);

      if (typeof name === 'string' && exportedNames.has(name)) {
        const init = node.init;

        if (
          isOxcNode(init) &&
          isNodeRecord(init) &&
          (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression')
        ) {
          if (targetOffset >= init.start && targetOffset <= init.end) {
            result = name;

            return false;
          }
        }
      }
    }

    return true;
  });

  return result;
};

/** Collect top-level let/var declarations from the program body. */
const collectTopLevelMutableVars = (program: Node): Array<{ name: string; offset: number }> => {
  const vars: Array<{ name: string; offset: number }> = [];

  if (!isNodeRecord(program) || program.type !== 'Program') {
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

    if (stmt.type === 'VariableDeclaration' && isNodeRecord(stmt)) {
      const kind = (stmt as any).kind;

      if (kind !== 'let' && kind !== 'var') {
        continue;
      }

      const declarations = (stmt as any).declarations;

      if (!Array.isArray(declarations)) {
        continue;
      }

      for (const declarator of declarations) {
        if (isOxcNode(declarator) && isNodeRecord(declarator)) {
          const name = getNodeName(declarator.id);

          if (typeof name === 'string' && name.length > 0) {
            vars.push({ name, offset: stmt.start });
          }
        }
      }
    }
  }

  return vars;
};

interface WriterReaderResult {
  readonly writers: ReadonlyArray<string>;
  readonly readers: ReadonlyArray<string>;
}

/** Build a Set of "start:end" keys for all write-position identifiers in the program (O(n)). */
const collectWritePositionKeys = (program: Node): Set<string> => {
  const keys = new Set<string>();

  walkOxcTree(program, node => {
    if (!isNodeRecord(node)) {
      return true;
    }

    if (node.type === 'AssignmentExpression') {
      const left = node.left;

      if (isOxcNode(left)) {
        keys.add(`${left.start}:${left.end}`);
      }
    }

    if (node.type === 'UpdateExpression') {
      const argument = node.argument;

      if (isOxcNode(argument)) {
        keys.add(`${argument.start}:${argument.end}`);
      }
    }

    return true;
  });

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
  const identifiers = collectOxcNodes(program, n => n.type === 'Identifier' && getNodeName(n) === varName);

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

/** Collect class state properties and classify methods as writers/readers. */
const analyzeClassTemporalCoupling = (
  program: Node,
  sourceText: string,
  rel: string,
  gildash?: Gildash,
): TemporalCouplingFinding[] => {
  const findings: TemporalCouplingFinding[] = [];
  const classes = collectOxcNodes(program, n => n.type === 'ClassDeclaration' || n.type === 'ClassExpression');

  for (const classNode of classes) {
    if (!isNodeRecord(classNode)) {
      continue;
    }

    // Extract class name — anonymous classes cannot be matched via gildash
    const className = typeof getNodeName(classNode.id) === 'string' ? (getNodeName(classNode.id) as string) : null;

    const classBody = classNode.body;

    if (!isOxcNode(classBody) || classBody.type !== 'ClassBody' || !isNodeRecord(classBody)) {
      continue;
    }

    const bodyItems = (classBody as any).body;

    if (!Array.isArray(bodyItems)) {
      continue;
    }

    // 1. Collect state properties (PropertyDefinition with initializer)
    const stateProps: Array<{ name: string; offset: number }> = [];

    for (const item of bodyItems) {
      if (!isOxcNode(item) || item.type !== 'PropertyDefinition' || !isNodeRecord(item)) {
        continue;
      }

      const propName = getNodeName(item.key);

      if (typeof propName !== 'string' || propName.length === 0) {
        continue;
      }

      stateProps.push({ name: propName, offset: item.start });
    }

    // 2. For each state property, classify methods as writers/readers
    for (const prop of stateProps) {
      const writerMethods = new Set<string>();
      const readerMethods = new Set<string>();

      for (const item of bodyItems) {
        if (!isOxcNode(item) || item.type !== 'MethodDefinition' || !isNodeRecord(item)) {
          continue;
        }

        const methodName = getNodeName(item.key);

        if (typeof methodName !== 'string' || methodName.length === 0) {
          continue;
        }

        if (methodName === 'constructor') {
          continue;
        }

        const methodBody = isOxcNode(item.value) && isNodeRecord(item.value) ? item.value : null;

        if (methodBody === null) {
          continue;
        }

        // Check all MemberExpression (this.propName) inside this method
        let hasWrite = false;
        let hasRead = false;

        walkOxcTree(methodBody, node => {
          if (node.type === 'MemberExpression' && isNodeRecord(node)) {
            const object = node.object;
            const property = node.property;

            if (
              isOxcNode(object) &&
              object.type === 'ThisExpression' &&
              isOxcNode(property) &&
              getNodeName(property) === prop.name
            ) {
              hasRead = true;
            }
          }

          if (node.type === 'AssignmentExpression' && isNodeRecord(node)) {
            const left = node.left;

            if (isOxcNode(left) && left.type === 'MemberExpression' && isNodeRecord(left)) {
              const obj = left.object;
              const p = left.property;

              if (isOxcNode(obj) && obj.type === 'ThisExpression' && isOxcNode(p) && getNodeName(p) === prop.name) {
                hasWrite = true;
              }
            }
          }

          return true;
        });

        if (hasWrite) {
          writerMethods.add(methodName);
        }

        if (hasRead && !hasWrite) {
          readerMethods.add(methodName);
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
          } catch {
            // gildash 에러 → AST-only fallback
          }
        }

        for (const _ of readerMethods) {
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

/** Collect offset ranges of conditional/loop nodes in a function body. */
const collectConditionalRanges = (funcBody: Node): Array<{ start: number; end: number }> => {
  const ranges: Array<{ start: number; end: number }> = [];
  const conditionalTypes = new Set([
    'IfStatement',
    'ConditionalExpression',
    'SwitchStatement',
    'LogicalExpression',
    'WhileStatement',
    'ForStatement',
    'ForInStatement',
    'ForOfStatement',
  ]);

  walkOxcTree(funcBody, node => {
    if (conditionalTypes.has(node.type) && isNodeRecord(node)) {
      ranges.push({ start: node.start, end: node.end });
    }

    return true;
  });

  return ranges;
};

/** Check if an offset falls inside any of the given ranges. */
const isInsideRange = (offset: number, ranges: ReadonlyArray<{ start: number; end: number }>): boolean => {
  for (const range of ranges) {
    if (offset >= range.start && offset <= range.end) {
      return true;
    }
  }

  return false;
};

/** Find a function body node for the given symbol name in the program. */
const findFunctionBody = (program: Node, symbolName: string): Node | null => {
  let result: Node | null = null;

  // Handle ClassName.method format
  const dotIndex = symbolName.indexOf('.');
  const isMethod = dotIndex !== -1;

  if (isMethod) {
    const className = symbolName.slice(0, dotIndex);
    const methodName = symbolName.slice(dotIndex + 1);

    walkOxcTree(program, node => {
      if (result !== null) return false;

      if ((node.type === 'ClassDeclaration' || node.type === 'ClassExpression') && isNodeRecord(node)) {
        const name = getNodeName(node.id);

        if (name !== className) return true;

        const classBody = node.body;

        if (!isOxcNode(classBody) || classBody.type !== 'ClassBody' || !isNodeRecord(classBody)) return false;

        const bodyItems = (classBody as any).body;

        if (!Array.isArray(bodyItems)) return false;

        for (const item of bodyItems) {
          if (!isOxcNode(item) || item.type !== 'MethodDefinition' || !isNodeRecord(item)) continue;

          const mName = getNodeName(item.key);

          if (mName !== methodName) continue;

          const methodValue = item.value;

          if (isOxcNode(methodValue) && isNodeRecord(methodValue)) {
            result = methodValue as Node;
          }

          return false;
        }

        return false;
      }

      return true;
    });

    return result;
  }

  // Plain function name
  walkOxcTree(program, node => {
    if (result !== null) return false;

    // FunctionDeclaration: function foo() {}
    if (node.type === 'FunctionDeclaration' && isNodeRecord(node)) {
      if (getNodeName(node.id) === symbolName) {
        result = node as Node;

        return false;
      }
    }

    // VariableDeclarator: const foo = () => {} or function() {}
    if (node.type === 'VariableDeclarator' && isNodeRecord(node)) {
      if (getNodeName(node.id) === symbolName) {
        const init = node.init;

        if (
          isOxcNode(init) &&
          isNodeRecord(init) &&
          (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression')
        ) {
          result = init as Node;

          return false;
        }
      }
    }

    return true;
  });

  return result;
};

/**
 * Collect call expression offsets for names in the given set within a function body.
 * Returns null if any matching call is inside a conditional/loop (conservative).
 */
const collectCallOffsetsStrict = (
  funcBody: Node,
  names: ReadonlySet<string>,
  conditionalRanges: ReadonlyArray<{ start: number; end: number }>,
): number[] | null => {
  const offsets: number[] = [];

  let hasConditional = false;

  walkOxcTree(funcBody, node => {
    if (node.type !== 'CallExpression' || !isNodeRecord(node)) return true;

    const callee = node.callee;

    if (!isOxcNode(callee)) return true;

    let callName: string | null = null;

    if (callee.type === 'Identifier') {
      callName = getNodeName(callee);
    } else if (callee.type === 'MemberExpression' && isNodeRecord(callee)) {
      callName = getNodeName(callee.property);
    }

    if (callName === null || !names.has(callName)) return true;

    if (isInsideRange(node.start, conditionalRanges)) {
      hasConditional = true;

      return false;
    }

    offsets.push(node.start);

    return true;
  });

  if (hasConditional) return null;

  return offsets;
};

/**
 * Verify that in every caller, at least one writer call appears before at least one reader call,
 * and no writer call is inside a conditional block.
 *
 * Returns true (allow suppression) only when all callers have writer-before-reader ordering
 * with no conditional branching around the writer calls.
 */
const verifyCallerOrder = (
  gildash: Gildash,
  writerNames: ReadonlyArray<string>,
  readerNames: ReadonlyArray<string>,
  callerKeys: ReadonlyArray<CallerKey>,
): boolean => {
  // Extract bare function names (strip ClassName. prefix) for call-site matching
  const writerBareNames = new Set(writerNames.map(n => (n.includes('.') ? n.slice(n.indexOf('.') + 1) : n)));
  const readerBareNames = new Set(readerNames.map(n => (n.includes('.') ? n.slice(n.indexOf('.') + 1) : n)));

  const getParsedAst = (gildash as any).getParsedAst as ((filePath: string) => unknown) | undefined;

  if (typeof getParsedAst !== 'function') {
    // gildash does not support AST retrieval → skip Phase 3, trust Phase 2 result
    return true;
  }

  for (const caller of callerKeys) {
    if (caller.srcSymbolName === null) continue;

    const parsed = getParsedAst.call(gildash, caller.srcFilePath) as { program: Node } | undefined;

    if (parsed === undefined || parsed === null) return false;

    const funcBody = findFunctionBody(parsed.program as Node, caller.srcSymbolName);

    if (funcBody === null) return false;

    const conditionalRanges = collectConditionalRanges(funcBody);

    const writerOffsets = collectCallOffsetsStrict(funcBody, writerBareNames, conditionalRanges);

    if (writerOffsets === null) return false; // writer inside branch → conservative

    const readerOffsets = collectCallOffsetsStrict(funcBody, readerBareNames, conditionalRanges);

    if (readerOffsets === null) return false;

    if (writerOffsets.length === 0 || readerOffsets.length === 0) return false;

    const minWriter = Math.min(...writerOffsets);
    const minReader = Math.min(...readerOffsets);

    if (minReader < minWriter) return false; // reader before writer
  }

  return true;
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

  // Phase 3: verify caller AST order
  return verifyCallerOrder(gildash, writerNames, readerNames, callerKeys);
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
    const exportedNames = collectExportedFunctionNames(file.program as Node);
    const writeKeys = collectWritePositionKeys(file.program as Node);

    for (const { name, offset } of mutableVars) {
      const { writers, readers } = classifyExportedFunctions(
        file.program as Node,
        file.sourceText,
        name,
        exportedNames,
        writeKeys,
      );

      if (writers.length > 0 && readers.length > 0) {
        // gildash 억제 검사
        if (input?.gildash !== undefined) {
          try {
            if (shouldSuppressByCallGraph(input.gildash, rel, writers, readers)) {
              continue;
            }
          } catch {
            // gildash 에러 → AST-only fallback
          }
        }

        for (const _ of readers) {
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
    }

    // Pattern 2: class state properties with writer/reader method split
    findings.push(...analyzeClassTemporalCoupling(file.program as Node, file.sourceText, rel, input?.gildash));
  }

  return findings;
};

export { analyzeTemporalCoupling, createEmptyTemporalCoupling };
export type { AnalyzeTemporalCouplingInput };
