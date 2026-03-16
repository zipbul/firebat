import type { Node } from 'oxc-parser';

import type { ParsedFile } from '../../engine/types';
import type { TemporalCouplingFinding } from '../../types';

import { collectOxcNodes, getNodeName, isNodeRecord, isOxcNode, walkOxcTree } from '../../engine/ast/oxc-ast-utils';
import { normalizeFile } from '../../engine/ast/normalize-file';
import { getLineColumn } from '../../engine/source-position';

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
): TemporalCouplingFinding[] => {
  const findings: TemporalCouplingFinding[] = [];
  const classes = collectOxcNodes(program, n => n.type === 'ClassDeclaration' || n.type === 'ClassExpression');

  for (const classNode of classes) {
    if (!isNodeRecord(classNode)) {
      continue;
    }

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

const analyzeTemporalCoupling = (files: ReadonlyArray<ParsedFile>): ReadonlyArray<TemporalCouplingFinding> => {
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
    findings.push(...analyzeClassTemporalCoupling(file.program as Node, file.sourceText, rel));
  }

  return findings;
};

export { analyzeTemporalCoupling, createEmptyTemporalCoupling };
