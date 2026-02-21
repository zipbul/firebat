import { describe, expect, it } from 'bun:test';

import { scanUseCase } from '../../../../src/application/scan/scan.usecase';
import { createScanLogger, createScanProjectFixtureWithFiles, withCwd } from '../../shared/scan-fixture';

const expectBaseFinding = (item: any): void => {
  expect(item).toBeDefined();
  expect(typeof item.kind).toBe('string');
  expect(typeof item.file).toBe('string');
  expect(item.file.endsWith('.ts')).toBe(true);
  expect(item.span).toBeDefined();
};

describe('integration/symmetry-breaking', () => {
  it('should report symmetry breaking when 9/10 handlers follow majority call sequence and one deviates', async () => {
    // Arrange
    const handler = (name: string, seq: ReadonlyArray<string>) => {
      const calls = seq.map(s => `  ${s}();`).join('\n');

      return `export function ${name}Handler() {\n${calls}\n}`;
    };

    const majority = ['validate', 'authorize', 'execute', 'respond'];
    const outlier = ['authorize', 'validate', 'execute', 'retryOnFailure', 'respond'];
    const files: Record<string, string> = {
      'src/steps.ts': [
        'export const validate = () => 0;',
        'export const authorize = () => 0;',
        'export const execute = () => 0;',
        'export const retryOnFailure = () => 0;',
        'export const respond = () => 0;',
      ].join('\n'),
    };

    for (let i = 0; i < 9; i++) {
      files[`src/h${i}.ts`] = `import { validate, authorize, execute, respond } from './steps';\n${handler(`h${i}`, majority)}`;
    }

    files['src/outlier.ts'] =
      "import { validate, authorize, execute, retryOnFailure, respond } from './steps';\n" + handler('payment', outlier);

    const project = await createScanProjectFixtureWithFiles('p1-symmetry-1', files);

    try {
      // Act
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [...project.targetsAbs],
            format: 'json',
            minSize: 0,
            maxForwardDepth: 0,
            exitOnFindings: false,
            detectors: ['symmetry-breaking' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['symmetry-breaking'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThan(0);

      for (const item of list ?? []) {
        expectBaseFinding(item);
      }
    } finally {
      await project.dispose();
    }
  });

  it('should report symmetry breaking when a single controller deviates in return structure', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('p1-symmetry-2', {
      'src/a.ts': 'export function aController() { if (1) return 1; return 2; }',
      'src/b.ts': 'export function bController() { if (1) return 1; return 2; }',
      'src/c.ts': 'export function cController() { if (1) return 1; return 2; }',
      'src/d.ts': 'export function dController() { if (1) return 1; return 2; }',
      'src/e.ts': 'export function eController() { return 123; }',
    });

    try {
      // Act
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [...project.targetsAbs],
            format: 'json',
            minSize: 0,
            maxForwardDepth: 0,
            exitOnFindings: false,
            detectors: ['symmetry-breaking' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['symmetry-breaking'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThan(0);
    } finally {
      await project.dispose();
    }
  });

  it('should support config-defined groups for symmetry breaking when configuration is present', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('p1-symmetry-3', {
      '.firebatrc.jsonc':
        '{\n  "features": {\n    "symmetry-breaking": {\n      "groups": [{ "name": "handlers", "glob": "src/handlers/**", "exportPattern": "*Handler" }]\n    }\n  }\n}',
      'src/handlers/a.ts': 'export function aHandler() { return 1; }',
      'src/handlers/b.ts': 'export function bHandler() { return 2; }',
      'src/handlers/c.ts': 'export function cHandler() { return 3; }',
    });

    try {
      // Act
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [...project.targetsAbs],
            format: 'json',
            minSize: 0,
            maxForwardDepth: 0,
            exitOnFindings: false,
            detectors: ['symmetry-breaking' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['symmetry-breaking'];

      expect(Array.isArray(list)).toBe(true);
    } finally {
      await project.dispose();
    }
  });

  it('should infer groups for symmetry breaking when groups are auto-inferred', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('p1-symmetry-4', {
      'src/controllers/a.ts': 'export function aController() { return 1; }',
      'src/controllers/b.ts': 'export function bController() { return 1; }',
      'src/controllers/c.ts': 'export function cController() { return 1; }',
      'src/controllers/d.ts': 'export function dController() { return 1; }',
      'src/controllers/e.ts': 'export function eController() { return 1; }',
      'src/controllers/f.ts': 'export function fController() { return 1; }',
      'src/controllers/g.ts': 'export function gController() { return 1; }',
      'src/controllers/h.ts': 'export function hController() { return 1; }',
      'src/controllers/i.ts': 'export function iController() { return 1; }',
      'src/controllers/out.ts': 'export function outController() { return 2; }',
    });

    try {
      // Act
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [...project.targetsAbs],
            format: 'json',
            minSize: 0,
            maxForwardDepth: 0,
            exitOnFindings: false,
            detectors: ['symmetry-breaking' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['symmetry-breaking'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBeGreaterThan(0);
    } finally {
      await project.dispose();
    }
  });

  it('should not emit natural-language fields in symmetry-breaking findings', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('p1-symmetry-5', {
      'src/a.ts': 'export function aHandler() { one(); two(); three(); }\nconst one=()=>0; const two=()=>0; const three=()=>0;',
      'src/b.ts': 'export function bHandler() { one(); two(); three(); }\nconst one=()=>0; const two=()=>0; const three=()=>0;',
      'src/c.ts':
        'export function cHandler() { one(); three(); two(); four(); }\nconst one=()=>0; const two=()=>0; const three=()=>0; const four=()=>0;',
    });

    try {
      // Act
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [...project.targetsAbs],
            format: 'json',
            minSize: 0,
            maxForwardDepth: 0,
            exitOnFindings: false,
            detectors: ['symmetry-breaking' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['symmetry-breaking'];

      expect(Array.isArray(list)).toBe(true);

      for (const item of list ?? []) {
        expectBaseFinding(item);
        expect(item.message).toBeUndefined();
        expect(item.why).toBeUndefined();
        expect(item.suggestedRefactor).toBeUndefined();
      }
    } finally {
      await project.dispose();
    }
  });

  it('should not report symmetry breaking when all handlers follow the same call sequence', async () => {
    // Arrange
    const handler = (name: string, seq: ReadonlyArray<string>) => {
      const calls = seq.map(s => `  ${s}();`).join('\n');

      return `export function ${name}Handler() {\n${calls}\n}`;
    };

    const seq = ['validate', 'authorize', 'execute', 'respond'];
    const files: Record<string, string> = {
      'src/steps.ts': [
        'export const validate = () => 0;',
        'export const authorize = () => 0;',
        'export const execute = () => 0;',
        'export const respond = () => 0;',
      ].join('\n'),
    };

    for (let i = 0; i < 10; i++) {
      files[`src/h${i}.ts`] = `import { validate, authorize, execute, respond } from './steps';\n${handler(`h${i}`, seq)}`;
    }

    const project = await createScanProjectFixtureWithFiles('p1-symmetry-neg-1', files);

    try {
      // Act
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [...project.targetsAbs],
            format: 'json',
            minSize: 0,
            maxForwardDepth: 0,
            exitOnFindings: false,
            detectors: ['symmetry-breaking' as any],
            fix: false,
            help: false,
          },
          { logger: createScanLogger() },
        ),
      );
      // Assert
      const list = (report as any)?.analyses?.['symmetry-breaking'];

      expect(Array.isArray(list)).toBe(true);
      expect((list ?? []).length).toBe(0);
    } finally {
      await project.dispose();
    }
  });
});
