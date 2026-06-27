import { describe, expect, it } from 'bun:test';

import { expectBaseFinding, expectNoOptionalFindingFields, scanDetectorFindings } from '../../shared/scan-fixture';

const repeatExports = (count: number, template: (i: number) => string): string => {
  return Array.from({ length: count }, (_, i) => template(i)).join('\n');
};

interface PositiveCase {
  readonly title: string;
  readonly prefix: string;
  readonly files: Readonly<Record<string, string>>;
}

const positiveCases: PositiveCase[] = [
  {
    title: 'a single file exceeds the configured maxLines threshold',
    prefix: 'giant-file-1',
    files: {
      '.firebatrc.jsonc': '{\n  "features": { "giant-file": { "maxLines": 1000 } }\n}',
      'src/a.ts': repeatExports(2000, i => `export const x${i} = ${i};`),
    },
  },
  {
    title: 'file is large due to many small exports',
    prefix: 'giant-file-2',
    files: {
      'src/a.ts': repeatExports(1500, i => `export const f${i} = () => ${i};`),
    },
  },
];

describe('integration/giant-file', () => {
  it.each(positiveCases)('should report giant-file when $title', async ({ prefix, files }) => {
    // Act
    const list = await scanDetectorFindings(prefix, 'giant-file', files);

    // Assert
    expect(list.length).toBeGreaterThan(0);
    expectBaseFinding(list[0], 'giant-file');
  });

  it('should include metrics in giant-file findings when reported', async () => {
    // Act
    const list = await scanDetectorFindings('giant-file-3', 'giant-file', {
      'src/a.ts': repeatExports(1200, i => `export const x${i} = ${i};`),
    });

    // Assert
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]?.metrics).toBeDefined();
    expect(typeof list[0]?.metrics).toBe('object');
  });

  it('should not emit natural-language fields in giant-file findings', async () => {
    // Act
    const list = await scanDetectorFindings('giant-file-4', 'giant-file', {
      'src/a.ts': repeatExports(1100, i => `export const x${i} = ${i};`),
    });

    // Assert
    for (const item of list) {
      expectBaseFinding(item, 'giant-file');
      expectNoOptionalFindingFields(item);
    }
  });

  it('should report giant-file findings with BaseFinding fields', async () => {
    // Act
    const list = await scanDetectorFindings('giant-file-5', 'giant-file', {
      'src/a.ts': repeatExports(1300, i => `export const x${i} = ${i};`),
    });

    // Assert
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]?.kind).toBe('giant-file');
    expect(typeof list[0]?.file).toBe('string');
    expect(list[0]?.span).toBeDefined();
    expect(list[0]?.code).toBeDefined();
  });

  it('should not report giant-file when line count does not exceed maxLines threshold', async () => {
    // Act
    const list = await scanDetectorFindings('giant-file-neg-1', 'giant-file', {
      '.firebatrc.jsonc': '{\n  "features": { "giant-file": { "maxLines": 1000 } }\n}',
      'src/a.ts': repeatExports(50, i => `export const x${i} = ${i};`),
    });

    // Assert
    expect(list.length).toBe(0);
  });
});
