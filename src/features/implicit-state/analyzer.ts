import type { Node } from 'oxc-parser';

import type { ParsedFile } from '../../engine/types';
import type { ImplicitStateFinding } from '../../types';

import { collectOxcNodes, getNodeName, isNodeRecord, isOxcNode } from '../../engine/ast/oxc-ast-utils';
import { normalizeFile } from '../../engine/ast/normalize-file';
import { getLineColumn } from '../../engine/source-position';

const createEmptyImplicitState = (): ReadonlyArray<ImplicitStateFinding> => [];

const spanForOffset = (sourceText: string, offset: number) => {
  const start = getLineColumn(sourceText, Math.max(0, offset));
  const end = getLineColumn(sourceText, Math.min(sourceText.length, Math.max(0, offset + 1)));

  return { start, end };
};

const addFinding = (out: ImplicitStateFinding[], file: ParsedFile, offset: number, codeOffset?: number) => {
  const rel = normalizeFile(file.filePath);

  if (!rel.endsWith('.ts')) {
    return;
  }

  const start = Math.max(0, codeOffset ?? offset);

  out.push({
    kind: 'implicit-state',
    code: 'IMPLICIT_STATE' as const,
    file: rel,
    span: spanForOffset(file.sourceText, offset),
    protocol: file.sourceText.slice(start, Math.min(file.sourceText.length, start + 60)),
  });
};

const analyzeImplicitState = (files: ReadonlyArray<ParsedFile>): ReadonlyArray<ImplicitStateFinding> => {
  if (files.length === 0) {
    return createEmptyImplicitState();
  }

  const findings: ImplicitStateFinding[] = [];
  // 1) process.env.KEY across multiple files — AST-based
  const envKeyToFiles = new Map<string, Set<number>>();

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    if (!file) continue;

    if (file.errors.length > 0) {
      continue;
    }

    const program = file.program as Node;
    const memberExprs = collectOxcNodes(program, n => n.type === 'MemberExpression');

    for (const expr of memberExprs) {
      if (!isNodeRecord(expr)) {
        continue;
      }

      // Match pattern: process.env.KEY
      const obj = expr.object;

      if (!isOxcNode(obj) || obj.type !== 'MemberExpression' || !isNodeRecord(obj)) {
        continue;
      }

      const innerObj = obj.object;
      const innerProp = obj.property;

      if (
        !isOxcNode(innerObj) || getNodeName(innerObj) !== 'process' ||
        !isOxcNode(innerProp) || getNodeName(innerProp) !== 'env'
      ) {
        continue;
      }

      const key = getNodeName(expr.property);

      if (typeof key !== 'string' || key.length === 0) {
        continue;
      }

      const set = envKeyToFiles.get(key) ?? new Set<number>();

      set.add(i);
      envKeyToFiles.set(key, set);
    }
  }

  for (const [key, idxs] of envKeyToFiles.entries()) {
    if (idxs.size < 2) {
      continue;
    }

    for (const idx of idxs) {
      const file = files[idx];

      if (!file) continue;

      const offset = file.sourceText.indexOf(`process.env.${key}`);

      addFinding(findings, file, Math.max(0, offset));
    }
  }

  // 2) singleton getInstance across multiple files — AST-based
  const getInstanceFiles: number[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    if (!file) continue;

    if (file.errors.length > 0) {
      continue;
    }

    const program = file.program as Node;
    const calls = collectOxcNodes(program, n => n.type === 'CallExpression');
    let found = false;

    for (const call of calls) {
      if (!isNodeRecord(call)) {
        continue;
      }

      const callee = call.callee;

      if (
        isOxcNode(callee) &&
        callee.type === 'MemberExpression' &&
        isNodeRecord(callee) &&
        getNodeName(callee.property) === 'getInstance'
      ) {
        found = true;
        break;
      }
    }

    if (found) {
      getInstanceFiles.push(i);
    }
  }

  if (getInstanceFiles.length >= 2) {
    for (const idx of getInstanceFiles) {
      const file = files[idx];

      if (!file) continue;

      const offset = file.sourceText.indexOf('getInstance()');

      addFinding(findings, file, Math.max(0, offset));
    }
  }

  // 3) stringly-typed event channels shared across files — AST-based
  const channelToFiles = new Map<string, Set<number>>();

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    if (!file) continue;

    if (file.errors.length > 0) {
      continue;
    }

    const program = file.program as Node;
    const calls = collectOxcNodes(program, n => n.type === 'CallExpression');

    for (const call of calls) {
      if (!isNodeRecord(call)) {
        continue;
      }

      const callee = call.callee;
      let calleeName: string | null = null;

      // emit('channel') or on('channel') — direct call
      if (isOxcNode(callee) && callee.type === 'Identifier') {
        calleeName = getNodeName(callee);
      }

      // obj.emit('channel') or obj.on('channel') — member call
      if (isOxcNode(callee) && callee.type === 'MemberExpression' && isNodeRecord(callee)) {
        calleeName = getNodeName(callee.property);
      }

      if (calleeName !== 'emit' && calleeName !== 'on') {
        continue;
      }

      const args = (call as any).arguments;

      if (!Array.isArray(args) || args.length === 0) {
        continue;
      }

      const firstArg = args[0];

      if (!isOxcNode(firstArg)) {
        continue;
      }

      // String literal argument — Literal or StringLiteral
      let channel: string | null = null;

      if (firstArg.type === 'Literal') {
        channel = isNodeRecord(firstArg) ? String((firstArg as any).value ?? '') : null;
      }

      if (typeof channel !== 'string' || channel.length === 0) {
        continue;
      }

      const set = channelToFiles.get(channel) ?? new Set<number>();

      set.add(i);
      channelToFiles.set(channel, set);
    }
  }

  for (const [channel, idxs] of channelToFiles.entries()) {
    if (idxs.size < 2) {
      continue;
    }

    for (const idx of idxs) {
      const file = files[idx];

      if (!file) continue;

      const offset =
        file.sourceText.indexOf(`'${channel}'`) >= 0
          ? file.sourceText.indexOf(`'${channel}'`)
          : file.sourceText.indexOf(`"${channel}"`);

      addFinding(findings, file, Math.max(0, offset));
    }
  }

  // 4) module-scope mutable state used across exported functions (AST-based)
  for (const file of files) {
    if (file.errors.length > 0) {
      continue;
    }

    const program = file.program as Node;

    if (!isNodeRecord(program) || program.type !== 'Program') {
      continue;
    }

    const body = program.body;

    if (!Array.isArray(body)) {
      continue;
    }

    // 4a) Collect top-level let/var variable names
    const mutableVars: Array<{ name: string; offset: number }> = [];

    for (const stmt of body) {
      if (!isOxcNode(stmt) || stmt.type !== 'VariableDeclaration' || !isNodeRecord(stmt)) {
        continue;
      }

      const kind = (stmt as any).kind;

      if (kind !== 'let' && kind !== 'var') {
        continue;
      }

      const declarations = (stmt as any).declarations;

      if (!Array.isArray(declarations)) {
        continue;
      }

      for (const decl of declarations) {
        if (isOxcNode(decl) && isNodeRecord(decl)) {
          const name = getNodeName(decl.id);

          if (typeof name === 'string' && name.length > 0) {
            mutableVars.push({ name, offset: stmt.start });
          }
        }
      }
    }

    if (mutableVars.length === 0) {
      continue;
    }

    // 4b) Count exported functions using AST
    let exportedFunctionCount = 0;

    for (const stmt of body) {
      if (
        isOxcNode(stmt) &&
        stmt.type === 'ExportNamedDeclaration' &&
        isNodeRecord(stmt)
      ) {
        const decl = stmt.declaration;

        if (isOxcNode(decl) && decl.type === 'FunctionDeclaration') {
          exportedFunctionCount++;
        }
      }
    }

    if (exportedFunctionCount < 2) {
      continue;
    }

    // 4c) For each mutable var, count AST Identifier references (not in declarations)
    for (const { name, offset } of mutableVars) {
      const identifiers = collectOxcNodes(program, n =>
        n.type === 'Identifier' && getNodeName(n) === name && n.start !== offset,
      );

      // Filter: only count identifiers inside exported function bodies
      let refCount = 0;

      for (const id of identifiers) {
        // Check if this identifier is inside an exported function
        for (const stmt of body) {
          if (
            isOxcNode(stmt) &&
            stmt.type === 'ExportNamedDeclaration' &&
            isNodeRecord(stmt)
          ) {
            const decl = stmt.declaration;

            if (
              isOxcNode(decl) &&
              decl.type === 'FunctionDeclaration' &&
              id.start >= decl.start &&
              id.end <= decl.end
            ) {
              refCount++;
              break;
            }
          }
        }
      }

      if (refCount >= 2) {
        addFinding(findings, file, offset);
      }
    }
  }

  return findings;
};

export { analyzeImplicitState, createEmptyImplicitState };
