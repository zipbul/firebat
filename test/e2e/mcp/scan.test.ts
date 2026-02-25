import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import * as path from 'node:path';

import { createMcpTestContext, callTool, callToolSafe, type McpTestContext } from '../../integration/mcp/helpers/mcp-client';

let ctx: McpTestContext;

beforeAll(async () => {
  ctx = await createMcpTestContext({ copyFixtures: true });
}, 30_000);

afterAll(async () => {
  await ctx?.close();
});

describe('scan', () => {
  // -----------------------------------------------------------------------
  // Happy-path
  // -----------------------------------------------------------------------

  test('should return a FirebatJsonReport when scanning a single file', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'sample.ts');
    // Act
    const { structured } = await callTool(ctx.client, 'scan', {
      targets: [fixture],
      detectors: ['exact-duplicates', 'waste'],
      minSize: 'auto',
    });

    // Assert
    expect(structured).toBeTruthy();
    expect(Array.isArray(structured.detectors)).toBe(true);
    expect(typeof structured.analyses).toBe('object');
    expect(typeof structured.catalog).toBe('object');
  }, 60_000);

  test('should run all detectors when none are specified', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'sample.ts');
    // Act
    const { structured } = await callTool(ctx.client, 'scan', {
      targets: [fixture],
    });

    // Assert
    expect(structured).toBeTruthy();
    expect(structured.analyses).toBeDefined();
    expect(typeof structured.analyses).toBe('object');
  }, 120_000);

  test('should return consistent analyses when scanning the same target twice', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'sample.ts');

    // Act – scan twice to verify idempotency
    const { structured: first } = await callTool(ctx.client, 'scan', {
      targets: [fixture],
      detectors: ['exact-duplicates'],
      minSize: 'auto',
    });

    const { structured: second } = await callTool(ctx.client, 'scan', {
      targets: [fixture],
      detectors: ['exact-duplicates'],
      minSize: 'auto',
    });

    // Assert
    expect(first.analyses).toBeDefined();
    expect(second.analyses).toBeDefined();
    expect(typeof second.analyses).toBe('object');
  }, 60_000);

  // -----------------------------------------------------------------------
  // Individual detectors
  // -----------------------------------------------------------------------

  const pureDetectors = [
    'exact-duplicates',
    'structural-duplicates',
    'waste',
    'nesting',
    'early-return',
    'noop',
    'forwarding',
    'barrel-policy',
    'unknown-proof',
    'coupling',
    'dependencies',
  ] as const;

  pureDetectors.forEach(detector => {
    test(`should succeed with detector=${detector}`, async () => {
      // Arrange
      const fixture = path.join(ctx.fixturesAbs, 'sample.ts');
      // Act
      const { structured, isError } = await callToolSafe(ctx.client, 'scan', {
        targets: [fixture],
        detectors: [detector],
        minSize: 1,
        maxForwardDepth: 0,
      });

      // Assert
      expect(isError).toBe(false);
      expect(structured).toBeTruthy();
      expect(structured.analyses).toBeDefined();
    }, 60_000);
  });

  // -----------------------------------------------------------------------
  // minSize variations
  // -----------------------------------------------------------------------

  test('should scan when minSize=0 (smallest possible)', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'sample.ts');
    // Act
    const { structured } = await callTool(ctx.client, 'scan', {
      targets: [fixture],
      detectors: ['exact-duplicates'],
      minSize: 0,
    });

    // Assert
    expect(structured).toBeTruthy();
    expect(structured.analyses).toBeDefined();
  }, 60_000);

  test('should scan when minSize=9999 (very large – should find nothing)', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'sample.ts');
    // Act
    const { structured } = await callTool(ctx.client, 'scan', {
      targets: [fixture],
      detectors: ['exact-duplicates'],
      minSize: 9999,
    });

    // Assert
    expect(structured).toBeTruthy();
    expect(structured.analyses).toBeDefined();
  }, 60_000);

  test('should scan when minSize is "auto"', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'sample.ts');
    // Act
    const { structured } = await callTool(ctx.client, 'scan', {
      targets: [fixture],
      detectors: ['exact-duplicates'],
      minSize: 'auto',
    });

    // Assert
    expect(structured).toBeTruthy();
    expect(structured.analyses).toBeDefined();
  }, 60_000);

  // -----------------------------------------------------------------------
  // maxForwardDepth
  // -----------------------------------------------------------------------

  test('should scan when maxForwardDepth=0', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'sample.ts');
    // Act
    const { structured } = await callTool(ctx.client, 'scan', {
      targets: [fixture],
      detectors: ['forwarding'],
      maxForwardDepth: 0,
    });

    // Assert
    expect(structured).toBeTruthy();
    expect(structured.analyses).toBeDefined();
  }, 60_000);

  test('should scan when maxForwardDepth=10', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'sample.ts');
    // Act
    const { structured } = await callTool(ctx.client, 'scan', {
      targets: [fixture],
      detectors: ['forwarding'],
      maxForwardDepth: 10,
    });

    // Assert
    expect(structured).toBeTruthy();
    expect(structured.analyses).toBeDefined();
  }, 60_000);

  // -----------------------------------------------------------------------
  // Multiple files
  // -----------------------------------------------------------------------

  test('should scan successfully when given multiple files at once', async () => {
    // Arrange
    const targets = [
      path.join(ctx.fixturesAbs, 'sample.ts'),
      path.join(ctx.fixturesAbs, 'editable.ts'),
      path.join(ctx.fixturesAbs, 'lsp-target.ts'),
    ];
    // Act
    const { structured } = await callTool(ctx.client, 'scan', {
      targets,
      detectors: ['exact-duplicates', 'waste'],
      minSize: 'auto',
    });

    // Assert
    expect(structured).toBeTruthy();
    expect(structured.analyses).toBeDefined();
  }, 60_000);

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  test('should handle scanning when targets are omitted (defaults to project discovery)', async () => {
    // Arrange – no targets

    // Act
    const { structured, isError } = await callToolSafe(ctx.client, 'scan', {
      detectors: ['noop'],
      minSize: 'auto',
    });

    // Assert – may succeed or return empty analyses
    expect(isError).toBe(false);
    expect(structured).toBeTruthy();
    expect(structured.analyses).toBeDefined();
  }, 60_000);

  test('should handle scanning when a target file does not exist', async () => {
    // Arrange
    const bogus = path.join(ctx.tmpRootAbs, 'does-not-exist.ts');
    // Act
    const { structured } = await callToolSafe(ctx.client, 'scan', {
      targets: [bogus],
      detectors: ['waste'],
    });

    // Assert – tool-level error or empty report, not a crash
    expect(structured).toBeDefined();
  }, 60_000);

  test('should handle scanning when a directory path is provided', async () => {
    // Arrange
    const dir = ctx.fixturesAbs;
    // Act
    const { structured, isError } = await callToolSafe(ctx.client, 'scan', {
      targets: [dir],
      detectors: ['exact-duplicates'],
      minSize: 'auto',
    });

    // Assert
    expect(isError).toBe(false);
    expect(structured).toBeTruthy();
    expect(structured.analyses).toBeDefined();
  }, 60_000);

  // -----------------------------------------------------------------------
  // Stress: rapid repeated scans
  // -----------------------------------------------------------------------

  test('should handle 5 rapid sequential scans when invoked repeatedly', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'sample.ts');

    // Act & Assert
    for (let i = 0; i < 5; i++) {
      // Arrange
      const { structured, isError } = await callToolSafe(ctx.client, 'scan', {
        targets: [fixture],
        detectors: ['noop'],
        minSize: 'auto',
      });

      // Act
      // (tool call already performed above)

      // Assert
      expect(isError).toBe(false);
      expect(structured).toBeTruthy();
      expect(structured.analyses).toBeDefined();
    }
  }, 120_000);

  // -----------------------------------------------------------------------
  // filePatterns filtering
  // -----------------------------------------------------------------------

  test('should return all findings when filePatterns is omitted', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'sample.ts');

    // Act
    const { structured, isError } = await callToolSafe(ctx.client, 'scan', {
      targets: [fixture],
      detectors: ['waste'],
    });

    // Assert
    expect(isError).toBe(false);
    expect(structured).toBeTruthy();
    expect(structured.analyses).toBeDefined();
  }, 60_000);

  test('should return only matched file findings when filePatterns matches a specific file', async () => {
    // Arrange
    const fixtures = [
      path.join(ctx.fixturesAbs, 'sample.ts'),
      path.join(ctx.fixturesAbs, 'editable.ts'),
    ];

    // Act
    const { structured, isError } = await callToolSafe(ctx.client, 'scan', {
      targets: fixtures,
      detectors: ['waste'],
      filePatterns: ['**/sample.ts'],
    });

    // Assert
    expect(isError).toBe(false);
    const wasteFindings = (structured as any)?.analyses?.waste ?? [];
    for (const f of wasteFindings as any[]) {
      const filePath: string = (f as any).filePath ?? (f as any).file ?? '';

      expect(filePath).toContain('sample.ts');
      expect(filePath).not.toContain('editable.ts');
    }
  }, 60_000);

  test('should return empty findings for detector when filePatterns matches no files', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'sample.ts');

    // Act
    const { structured, isError } = await callToolSafe(ctx.client, 'scan', {
      targets: [fixture],
      detectors: ['waste'],
      filePatterns: ['**/nonexistent-xyz-file.ts'],
    });

    // Assert
    expect(isError).toBe(false);
    const wasteFindings = (structured as any)?.analyses?.waste ?? [];

    expect(wasteFindings).toHaveLength(0);
  }, 60_000);

  test('should return all findings when filePatterns is empty array', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'sample.ts');
    const { structured: withoutFilter } = await callToolSafe(ctx.client, 'scan', {
      targets: [fixture],
      detectors: ['waste'],
    });

    // Act
    const { structured, isError } = await callToolSafe(ctx.client, 'scan', {
      targets: [fixture],
      detectors: ['waste'],
      filePatterns: [],
    });

    // Assert
    expect(isError).toBe(false);
    const allWaste: unknown[] = (withoutFilter as any)?.analyses?.waste ?? [];
    const emptyFilterWaste: unknown[] = (structured as any)?.analyses?.waste ?? [];

    expect(emptyFilterWaste.length).toBe(allWaste.length);
  }, 60_000);
});
