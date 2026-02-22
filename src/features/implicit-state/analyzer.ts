import type { ParsedFile } from '../../engine/types';
import type { ImplicitStateFinding } from '../../types';

import { normalizeFile } from '../../engine/normalize-file';
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
  // 1) process.env.KEY across multiple files
  const envKeyToFiles = new Map<string, Set<number>>();
  const envRe = /process\.env\.([A-Z0-9_]+)/g;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    if (file.errors.length > 0) {
      continue;
    }

    for (;;) {
      const m = envRe.exec(file.sourceText);

      if (m === null) {
        break;
      }

      const key = String(m[1] ?? '');
      const set = envKeyToFiles.get(key) ?? new Set<number>();

      set.add(i);
      envKeyToFiles.set(key, set);
    }

    envRe.lastIndex = 0;
  }

  for (const [key, idxs] of envKeyToFiles.entries()) {
    if (idxs.size < 2) {
      continue;
    }

    for (const idx of idxs) {
      const file = files[idx];
      const offset = file.sourceText.indexOf(`process.env.${key}`);

      addFinding(findings, file, Math.max(0, offset));
    }
  }

  // 2) singleton getInstance across multiple files
  const getInstanceFiles: number[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    if (file.errors.length > 0) {
      continue;
    }

    if (file.sourceText.includes('getInstance()')) {
      getInstanceFiles.push(i);
    }
  }

  if (getInstanceFiles.length >= 2) {
    for (const idx of getInstanceFiles) {
      const file = files[idx];
      const offset = file.sourceText.indexOf('getInstance()');

      addFinding(findings, file, Math.max(0, offset));
    }
  }

  // 3) stringly-typed event channels shared across files
  const channelToFiles = new Map<string, Set<number>>();
  const channelRe = /\b(emit|on)\(\s*['"]([^'"]+)['"]\s*\)/g;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    if (file.errors.length > 0) {
      continue;
    }

    for (;;) {
      const m = channelRe.exec(file.sourceText);

      if (m === null) {
        break;
      }

      const channel = String(m[2] ?? '');
      const set = channelToFiles.get(channel) ?? new Set<number>();

      set.add(i);
      channelToFiles.set(channel, set);
    }

    channelRe.lastIndex = 0;
  }

  for (const [channel, idxs] of channelToFiles.entries()) {
    if (idxs.size < 2) {
      continue;
    }

    for (const idx of idxs) {
      const file = files[idx];
      const offset =
        file.sourceText.indexOf(`'${channel}'`) >= 0
          ? file.sourceText.indexOf(`'${channel}'`)
          : file.sourceText.indexOf(`"${channel}"`);

      addFinding(findings, file, Math.max(0, offset));
    }
  }

  // 4) module-scope mutable state used across exported functions
  const moduleStateRe = /^\s*(let|var)\s+([a-zA-Z_$][\w$]*)\b/m;

  for (const file of files) {
    if (file.errors.length > 0) {
      continue;
    }

    const m = moduleStateRe.exec(file.sourceText);

    if (m === null) {
      continue;
    }

    const name = String(m[2] ?? '');
    const exports = (file.sourceText.match(/\bexport\s+function\b/g) ?? []).length;

    if (exports >= 2 && (file.sourceText.match(new RegExp(`\\b${name}\\b`, 'g')) ?? []).length >= 2) {
      addFinding(findings, file, m.index);
    }
  }

  return findings;
};

export { analyzeImplicitState, createEmptyImplicitState };
