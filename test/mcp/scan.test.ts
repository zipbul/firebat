import * as path from 'node:path';
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createMcpTestContext, callTool, callToolSafe, type McpTestContext } from './helpers/mcp-client';

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

  test('should return a report with timings when scanning a single file', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'sample.ts');

    // Act
    const { structured } = await callTool(ctx.client, 'scan', {
      targets: [fixture],
      detectors: ['exact-duplicates', 'waste'],
      minSize: 'auto',
    });

    // Assert
    expect(structured.report).toBeTruthy();
    expect(structured.timings).toBeDefined();
    expect(typeof structured.timings.totalMs).toBe('number');
    expect(structured.timings.totalMs).toBeGreaterThanOrEqual(0);
  }, 60_000);

  test('should run all detectors when none are specified', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'sample.ts');

    // Act
    const { structured } = await callTool(ctx.client, 'scan', {
      targets: [fixture],
    });

    // Assert
    expect(structured.report).toBeTruthy();
    expect(structured.report.analyses).toBeDefined();
    expect(typeof structured.report.analyses).toBe('object');
  }, 120_000);

  test('should produce a diff object on subsequent scans', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'sample.ts');

    // Act – first scan primes lastReport; second scan produces diff
    await callTool(ctx.client, 'scan', {
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
    expect(second.diff).toBeDefined();
    expect(typeof second.diff.newFindings).toBe('number');
    expect(typeof second.diff.resolvedFindings).toBe('number');
    expect(typeof second.diff.unchangedFindings).toBe('number');
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
    'api-drift',
  ] as const;

  for (const detector of pureDetectors) {
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
      expect(structured.report).toBeTruthy();
      expect(structured.report.analyses).toBeDefined();
    }, 60_000);
  }

  // -----------------------------------------------------------------------
  // minSize variations
  // -----------------------------------------------------------------------

  test('should scan with minSize=0 (smallest possible)', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'sample.ts');

    // Act
    const { structured } = await callTool(ctx.client, 'scan', {
      targets: [fixture],
      detectors: ['exact-duplicates'],
      minSize: 0,
    });

    // Assert
    expect(structured.report).toBeTruthy();
  }, 60_000);

  test('should scan with minSize=9999 (very large – should find nothing)', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'sample.ts');

    // Act
    const { structured } = await callTool(ctx.client, 'scan', {
      targets: [fixture],
      detectors: ['exact-duplicates'],
      minSize: 9999,
    });

    // Assert
    expect(structured.report).toBeTruthy();
  }, 60_000);

  test('should scan with minSize="auto"', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'sample.ts');

    // Act
    const { structured } = await callTool(ctx.client, 'scan', {
      targets: [fixture],
      detectors: ['exact-duplicates'],
      minSize: 'auto',
    });

    // Assert
    expect(structured.report).toBeTruthy();
  }, 60_000);

  // -----------------------------------------------------------------------
  // maxForwardDepth
  // -----------------------------------------------------------------------

  test('should scan with maxForwardDepth=0', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'sample.ts');

    // Act
    const { structured } = await callTool(ctx.client, 'scan', {
      targets: [fixture],
      detectors: ['forwarding'],
      maxForwardDepth: 0,
    });

    // Assert
    expect(structured.report).toBeTruthy();
  }, 60_000);

  test('should scan with maxForwardDepth=10', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'sample.ts');

    // Act
    const { structured } = await callTool(ctx.client, 'scan', {
      targets: [fixture],
      detectors: ['forwarding'],
      maxForwardDepth: 10,
    });

    // Assert
    expect(structured.report).toBeTruthy();
  }, 60_000);

  // -----------------------------------------------------------------------
  // Multiple files
  // -----------------------------------------------------------------------

  test('should scan multiple files at once', async () => {
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
    expect(structured.report).toBeTruthy();
  }, 60_000);

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  test('should handle scanning an empty targets array (defaults to project discovery)', async () => {
    // Arrange – no targets

    // Act
    const { structured, isError } = await callToolSafe(ctx.client, 'scan', {
      detectors: ['noop'],
      minSize: 'auto',
    });

    // Assert – may succeed or return empty analyses
    expect(isError).toBe(false);
    expect(structured.report).toBeTruthy();
  }, 60_000);

  test('should handle scanning a non-existent file gracefully', async () => {
    // Arrange
    const bogus = path.join(ctx.tmpRootAbs, 'does-not-exist.ts');

    // Act
    const { structured, isError } = await callToolSafe(ctx.client, 'scan', {
      targets: [bogus],
      detectors: ['waste'],
    });

    // Assert – tool-level error or empty report, not a crash
    expect(structured).toBeDefined();
  }, 60_000);

  test('should handle scanning a directory path', async () => {
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
    expect(structured.report).toBeTruthy();
  }, 60_000);

  // -----------------------------------------------------------------------
  // Stress: rapid repeated scans
  // -----------------------------------------------------------------------

  test('should handle 5 rapid sequential scans without crashing', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'sample.ts');

    // Act & Assert
    for (let i = 0; i < 5; i++) {
      const { structured, isError } = await callToolSafe(ctx.client, 'scan', {
        targets: [fixture],
        detectors: ['noop'],
        minSize: 'auto',
      });
      expect(isError).toBe(false);
      expect(structured.report).toBeTruthy();
    }
  }, 120_000);
});
