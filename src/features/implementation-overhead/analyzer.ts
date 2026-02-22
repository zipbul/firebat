import type { ParsedFile } from '../../engine/types';
import type { ImplementationOverheadFinding } from '../../types';

import { normalizeFile } from '../../engine/normalize-file';
import { getLineColumn } from '../../engine/source-position';

const createEmptyImplementationOverhead = (): ReadonlyArray<ImplementationOverheadFinding> => [];

const spanForOffsets = (sourceText: string, startOffset: number, endOffset: number) => {
  const start = getLineColumn(sourceText, Math.max(0, startOffset));
  const end = getLineColumn(sourceText, Math.max(0, endOffset));

  return { start, end };
};

interface AnalyzeImplementationOverheadOptions {
  readonly minRatio: number;
}

const countTopLevelParams = (paramsText: string): number => {
  const text = paramsText.trim();

  if (text.length === 0) {
    return 0;
  }

  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;
  let depthAngle = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let count = 1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;

    if (inSingle) {
      if (ch === '\\') {
        i++;

        continue;
      }

      if (ch === "'") {
        inSingle = false;
      }
      continue;
    }

    if (inDouble) {
      if (ch === '\\') {
        i++;

        continue;
      }

      if (ch === '"') {
        inDouble = false;
      }
      continue;
    }

    if (inTemplate) {
      if (ch === '\\') {
        i++;

        continue;
      }

      if (ch === '`') {
        inTemplate = false;
      }
      continue;
    }

    if (ch === "'") {
      inSingle = true;

      continue;
    }

    if (ch === '"') {
      inDouble = true;

      continue;
    }

    if (ch === '`') {
      inTemplate = true;

      continue;
    }

    if (ch === '(') {
      depthParen += 1;
    } else if (ch === ')') {
      depthParen = Math.max(0, depthParen - 1);
    } else if (ch === '{') {
      depthBrace += 1;
    } else if (ch === '}') {
      depthBrace = Math.max(0, depthBrace - 1);
    } else if (ch === '[') {
      depthBracket += 1;
    } else if (ch === ']') {
      depthBracket = Math.max(0, depthBracket - 1);
    } else if (ch === '<') {
      depthAngle += 1;
    } else if (ch === '>') {
      depthAngle = Math.max(0, depthAngle - 1);
    } else if (ch === ',' && depthParen === 0 && depthBrace === 0 && depthBracket === 0 && depthAngle === 0) {
      count += 1;
    }
  }

  return count;
};

const estimateInterfaceComplexity = (signature: string, paramsText: string): number => {
  const hasReturnType = signature.includes('):') || signature.includes(') :');
  const paramCount = countTopLevelParams(paramsText);
  const raw = paramCount + (hasReturnType ? 1 : 0);

  return Math.max(1, raw);
};

const estimateImplementationComplexity = (body: string): number => {
  const semicolons = (body.match(/;/g) ?? []).length;
  const ifs = (body.match(/\bif\b/g) ?? []).length;
  const fors = (body.match(/\bfor\b/g) ?? []).length;

  return Math.max(1, semicolons + ifs + fors);
};

const findMatchingParen = (sourceText: string, openParenOffset: number): number => {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;

  for (let i = openParenOffset; i < sourceText.length; i++) {
    const ch = sourceText[i] as string;

    if (inSingle) {
      if (ch === '\\') {
        i++;

        continue;
      }

      if (ch === "'") {
        inSingle = false;
      }
      continue;
    }

    if (inDouble) {
      if (ch === '\\') {
        i++;

        continue;
      }

      if (ch === '"') {
        inDouble = false;
      }
      continue;
    }

    if (inTemplate) {
      if (ch === '\\') {
        i++;

        continue;
      }

      if (ch === '`') {
        inTemplate = false;
      }
      continue;
    }

    if (ch === "'") {
      inSingle = true;

      continue;
    }

    if (ch === '"') {
      inDouble = true;

      continue;
    }

    if (ch === '`') {
      inTemplate = true;

      continue;
    }

    if (ch === '(') {
      depth += 1;

      continue;
    }

    if (ch === ')') {
      depth -= 1;

      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
};

const findFunctionBodyOpenBrace = (sourceText: string, afterParamsOffset: number): number => {
  let inReturnType = false;
  let depthBrace = 0;
  let depthParen = 0;
  let depthBracket = 0;
  let depthAngle = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let prevNonSpace = '';

  // Determine if there is a return type annotation.
  for (let i = afterParamsOffset + 1; i < sourceText.length; i++) {
    const ch = sourceText[i] as string;

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      continue;
    }

    if (ch === ':') {
      inReturnType = true;
    }
    break;
  }

  for (let i = afterParamsOffset + 1; i < sourceText.length; i++) {
    const ch = sourceText[i] as string;

    if (inSingle) {
      if (ch === '\\') {
        i++;

        continue;
      }

      if (ch === "'") {
        inSingle = false;
      }
      continue;
    }

    if (inDouble) {
      if (ch === '\\') {
        i++;

        continue;
      }

      if (ch === '"') {
        inDouble = false;
      }
      continue;
    }

    if (inTemplate) {
      if (ch === '\\') {
        i++;

        continue;
      }

      if (ch === '`') {
        inTemplate = false;
      }
      continue;
    }

    if (ch === "'") {
      inSingle = true;

      continue;
    }

    if (ch === '"') {
      inDouble = true;

      continue;
    }

    if (ch === '`') {
      inTemplate = true;

      continue;
    }

    if (ch === '(') {
      depthParen += 1;
    } else if (ch === ')') {
      depthParen = Math.max(0, depthParen - 1);
    } else if (ch === '[') {
      depthBracket += 1;
    } else if (ch === ']') {
      depthBracket = Math.max(0, depthBracket - 1);
    } else if (ch === '<') {
      depthAngle += 1;
    } else if (ch === '>') {
      depthAngle = Math.max(0, depthAngle - 1);
    }

    if (ch === '{') {
      if (
        inReturnType &&
        depthBrace === 0 &&
        depthParen === 0 &&
        depthBracket === 0 &&
        depthAngle === 0 &&
        prevNonSpace === ':'
      ) {
        depthBrace += 1;

        prevNonSpace = ch;

        continue;
      }

      if (depthBrace === 0 && depthParen === 0 && depthBracket === 0 && depthAngle === 0) {
        return i;
      }

      depthBrace += 1;
    } else if (ch === '}') {
      depthBrace = Math.max(0, depthBrace - 1);
    }

    if (!(ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r')) {
      prevNonSpace = ch;
    }
  }

  return -1;
};

const findMatchingBrace = (sourceText: string, openBraceOffset: number): number => {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;

  for (let i = openBraceOffset; i < sourceText.length; i++) {
    const ch = sourceText[i] as string;

    if (inSingle) {
      if (ch === '\\') {
        i++;

        continue;
      }

      if (ch === "'") {
        inSingle = false;
      }
      continue;
    }

    if (inDouble) {
      if (ch === '\\') {
        i++;

        continue;
      }

      if (ch === '"') {
        inDouble = false;
      }
      continue;
    }

    if (inTemplate) {
      if (ch === '\\') {
        i++;

        continue;
      }

      if (ch === '`') {
        inTemplate = false;
      }
      continue;
    }

    if (ch === "'") {
      inSingle = true;

      continue;
    }

    if (ch === '"') {
      inDouble = true;

      continue;
    }

    if (ch === '`') {
      inTemplate = true;

      continue;
    }

    if (ch === '{') {
      depth += 1;

      continue;
    }

    if (ch === '}') {
      depth -= 1;

      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
};

const analyzeImplementationOverhead = (
  files: ReadonlyArray<ParsedFile>,
  options: AnalyzeImplementationOverheadOptions,
): ReadonlyArray<ImplementationOverheadFinding> => {
  if (files.length === 0) {
    return createEmptyImplementationOverhead();
  }

  const minRatio = Math.max(0, options.minRatio);
  const findings: ImplementationOverheadFinding[] = [];

  for (const file of files) {
    if (file.errors.length > 0) {
      continue;
    }

    const rel = normalizeFile(file.filePath);

    if (!rel.endsWith('.ts')) {
      continue;
    }

    const fnRe = /\bexport\s+function\s+([a-zA-Z_$][\w$]*)\s*\(/g;

    for (;;) {
      const m = fnRe.exec(file.sourceText);

      if (m === null) {
        break;
      }

      const startOffset = m.index;
      const openParenOffset = file.sourceText.indexOf('(', startOffset);

      if (openParenOffset < 0) {
        continue;
      }

      const closeParenOffset = findMatchingParen(file.sourceText, openParenOffset);

      if (closeParenOffset < 0) {
        continue;
      }

      const bodyOpenOffset = findFunctionBodyOpenBrace(file.sourceText, closeParenOffset);

      if (bodyOpenOffset < 0) {
        continue;
      }

      const bodyCloseOffset = findMatchingBrace(file.sourceText, bodyOpenOffset);
      const endOffset = bodyCloseOffset >= 0 ? bodyCloseOffset + 1 : file.sourceText.length;
      const signature = file.sourceText.slice(startOffset, bodyOpenOffset);
      const paramsText = file.sourceText.slice(openParenOffset + 1, closeParenOffset);
      const body = file.sourceText.slice(bodyOpenOffset, endOffset);
      const interfaceComplexity = estimateInterfaceComplexity(signature, paramsText);
      const implementationComplexity = estimateImplementationComplexity(body);
      const ratio = implementationComplexity / Math.max(1, interfaceComplexity);

      if (!(ratio > minRatio)) {
        continue;
      }

      const evidenceEnd = Math.min(file.sourceText.length, startOffset + 200);

      findings.push({
        kind: 'implementation-overhead',
        file: rel,
        span: spanForOffsets(file.sourceText, startOffset, evidenceEnd),
        interfaceComplexity,
        implementationComplexity,
        ratio,
      });
    }

    // Support arrow exported functions in a minimal way.
    const arrowRe = /\bexport\s+const\s+([a-zA-Z_$][\w$]*)\s*=\s*\(([^)]*)\)\s*=>/g;

    for (;;) {
      const m = arrowRe.exec(file.sourceText);

      if (m === null) {
        break;
      }

      const startOffset = m.index;
      const signatureEnd = arrowRe.lastIndex;
      const signature = file.sourceText.slice(startOffset, signatureEnd);
      const rest = file.sourceText.slice(signatureEnd);
      const endOffset = signatureEnd + Math.min(rest.length, 400);
      const body = file.sourceText.slice(signatureEnd, endOffset);
      const paramsText = String(m[2] ?? '');
      const interfaceComplexity = estimateInterfaceComplexity(signature, paramsText);
      const implementationComplexity = estimateImplementationComplexity(body);
      const ratio = implementationComplexity / Math.max(1, interfaceComplexity);

      if (!(ratio > minRatio)) {
        continue;
      }

      const evidenceEnd2 = Math.min(file.sourceText.length, startOffset + 200);

      findings.push({
        kind: 'implementation-overhead',
        file: rel,
        span: spanForOffsets(file.sourceText, startOffset, evidenceEnd2),
        interfaceComplexity,
        implementationComplexity,
        ratio,
      });
    }
  }

  return findings;
};

export { analyzeImplementationOverhead, createEmptyImplementationOverhead };
