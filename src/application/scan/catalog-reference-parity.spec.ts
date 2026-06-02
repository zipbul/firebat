import { describe, expect, it } from 'bun:test';
import * as path from 'node:path';

import { FIREBAT_CODE_CATALOG } from './diagnostic-aggregator';

/**
 * Guards against drift between the single-source catalog (`FIREBAT_CODE_CATALOG`)
 * and the skill reference markdown that subagents actually read via
 * `extract-reference.sh`. The two are different serializations (JS object vs
 * markdown with bold + numbered lists), so the comparison is NORMALIZED
 * (strip `**bold**`, list markers, and collapse whitespace) rather than byte-equal.
 *
 * Scope: waste + error-flow (the detectors whose guidance is concept-aligned).
 * Add a prefix → file entry to extend coverage to other categories.
 */
const REF_DIR = path.resolve(import.meta.dir, '../../../.claude/skills/firebat/references');
const PREFIX_TO_FILE: ReadonlyArray<readonly [string, string]> = [
  ['WASTE_', 'waste.md'],
  ['EF_', 'error-flow.md'],
];

interface RefSection {
  readonly cause: string;
  readonly think: ReadonlyArray<string>;
}

const normalize = (text: string): string =>
  text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

const parseReferenceFile = (markdown: string): ReadonlyMap<string, RefSection> => {
  const sections = new Map<string, RefSection>();

  for (const block of markdown.split(/^## /m).slice(1)) {
    const code = (block.split('\n', 1)[0] ?? '').trim();
    const causeMatch = block.match(/\*\*Cause:\*\*\s*([\s\S]*?)\n\n/);
    const thinkMatch = block.match(/<think>([\s\S]*?)<\/think>/);
    const think: string[] = [];

    for (const item of (thinkMatch?.[1] ?? '').matchAll(/^\d+\.\s+(.+)$/gm)) {
      think.push(item[1] ?? '');
    }

    sections.set(code, { cause: (causeMatch?.[1] ?? '').trim(), think });
  }

  return sections;
};

const fileFor = (code: string): string | null => {
  for (const [prefix, file] of PREFIX_TO_FILE) {
    if (code.startsWith(prefix)) {
      return file;
    }
  }

  return null;
};

describe('catalog ↔ reference parity (waste + error-flow)', () => {
  const refCache = new Map<string, ReadonlyMap<string, RefSection>>();

  const loadRef = (file: string): ReadonlyMap<string, RefSection> => {
    const cached = refCache.get(file);

    if (cached) {
      return cached;
    }

    const parsed = parseReferenceFile(require('node:fs').readFileSync(path.join(REF_DIR, file), 'utf8'));

    refCache.set(file, parsed);

    return parsed;
  };

  const inScopeCodes = Object.keys(FIREBAT_CODE_CATALOG).filter(code => fileFor(code) !== null);

  it('every in-scope catalog code has a matching reference section', () => {
    for (const code of inScopeCodes) {
      const file = fileFor(code)!;

      expect(loadRef(file).has(code), `${code} missing from ${file}`).toBe(true);
    }
  });

  it('cause text matches (normalized) between catalog and reference', () => {
    for (const code of inScopeCodes) {
      const entry = FIREBAT_CODE_CATALOG[code as keyof typeof FIREBAT_CODE_CATALOG];
      const ref = loadRef(fileFor(code)!).get(code);

      expect(ref, `${code} section`).toBeDefined();
      expect(normalize(ref!.cause), `${code} cause`).toBe(normalize(entry.cause));
    }
  });

  it('think steps match (normalized, element-for-element) between catalog and reference', () => {
    for (const code of inScopeCodes) {
      const entry = FIREBAT_CODE_CATALOG[code as keyof typeof FIREBAT_CODE_CATALOG];
      const ref = loadRef(fileFor(code)!).get(code)!;
      const catalogThink = entry.think.map(normalize);
      const refThink = ref.think.map(normalize);

      expect(refThink, `${code} think step count`).toHaveLength(catalogThink.length);
      expect(refThink, `${code} think steps`).toEqual(catalogThink);
    }
  });

  it('no orphan reference sections for in-scope files (every section maps to a catalog code)', () => {
    const catalogCodes = new Set(Object.keys(FIREBAT_CODE_CATALOG));

    for (const [, file] of PREFIX_TO_FILE) {
      for (const code of loadRef(file).keys()) {
        expect(catalogCodes.has(code), `${file} has orphan section ${code}`).toBe(true);
      }
    }
  });
});
