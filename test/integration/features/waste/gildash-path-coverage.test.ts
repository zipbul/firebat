/**
 * Sanity test: golden waste fixtures actually route through the gildash
 * `getFileBindings` path (not the ScopeTracker fallback).
 *
 * Uses telemetry counters maintained by gildash-binding-source. Resets the
 * counter before invoking detectWaste over a disk-backed fixture, asserts
 * the gildash hit count incremented.
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { detectWaste, parseSource } from '../../../../src/test-api';
import {
  getBindingSourceTelemetry,
  registerFixtureRealPath,
  resetBindingSourceTelemetry,
} from '../../../../src/engine/dataflow/gildash-binding-source';

const FIXTURES_DIR = path.join(__dirname, '__fixtures__');

describe('gildash binding source telemetry', () => {
  beforeEach(() => {
    resetBindingSourceTelemetry();
  });

  it('routes a single-file waste fixture through gildash getFileBindings', () => {
    const fixturePath = path.join(FIXTURES_DIR, 'no-escape-object.ts');
    const src = fs.readFileSync(fixturePath, 'utf8');
    const virtualPath = '/virtual/no-escape-object.ts';

    registerFixtureRealPath(virtualPath, fixturePath);
    const findings = detectWaste([parseSource(virtualPath, src)]);

    expect(findings.length).toBeGreaterThan(0);

    const telemetry = getBindingSourceTelemetry();

    expect(telemetry.gildashHits).toBeGreaterThan(0);
  });

  it('records a miss when no virtual→real mapping is registered for an in-memory path', () => {
    const src = 'export function f(): number { let x = 1; return x; }';
    const virtualPath = '/virtual/_unregistered_inmemory.ts';

    detectWaste([parseSource(virtualPath, src)]);

    const telemetry = getBindingSourceTelemetry();

    expect(telemetry.gildashMisses).toBeGreaterThan(0);
  });
});
