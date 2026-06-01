/**
 * Sanity test: waste detection routes binding resolution through gildash's
 * standalone binding path (getStandaloneFileBindings), not any fallback.
 *
 * Uses telemetry counters maintained by gildash-binding-source: resets before
 * invoking detectWaste, asserts the gildash hit count incremented.
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { getBindingSourceTelemetry, resetBindingSourceTelemetry } from '../../../../src/engine/dataflow/gildash-binding-source';
import { detectWaste, parseSource } from '../../../../src/test-api';

const FIXTURES_DIR = path.join(__dirname, '__fixtures__');

describe('gildash binding source telemetry', () => {
  beforeEach(() => {
    resetBindingSourceTelemetry();
  });

  it('routes a disk-backed waste fixture through gildash standalone bindings', () => {
    const fixturePath = path.join(FIXTURES_DIR, 'no-escape-object.ts');
    const src = fs.readFileSync(fixturePath, 'utf8');
    const findings = detectWaste([parseSource('/virtual/no-escape-object.ts', src)]);

    expect(findings.length).toBeGreaterThan(0);

    const telemetry = getBindingSourceTelemetry();

    expect(telemetry.gildashHits).toBeGreaterThan(0);
  });

  it('resolves an in-memory virtual source via standalone bindings (sourceText flows directly)', () => {
    const src = 'export function f(): number { let x = 1; return x; }';

    detectWaste([parseSource('/virtual/_inmemory.ts', src)]);

    const telemetry = getBindingSourceTelemetry();

    expect(telemetry.gildashHits).toBeGreaterThan(0);
  });
});
