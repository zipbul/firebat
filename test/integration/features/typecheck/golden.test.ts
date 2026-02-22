import { describe } from 'bun:test';

import { __test__ } from '../../../../src/features/typecheck/detector';
import { runGolden } from '../../shared/golden-runner';

const { pullDiagnosticsToItems } = __test__;

describe('golden/typecheck', () => {
  runGolden(import.meta.dir, 'pull-diagnostics', (_, sources) => {
    const rawJson = Object.values(sources)[0] ?? '';

    try {
      return pullDiagnosticsToItems(JSON.parse(rawJson) as unknown);
    } catch {
      return [];
    }
  });

  runGolden(import.meta.dir, 'typecheck-empty', (_, sources) => {
    const rawJson = Object.values(sources)[0] ?? '';

    try {
      return pullDiagnosticsToItems(JSON.parse(rawJson) as unknown);
    } catch {
      return [];
    }
  });

  runGolden(import.meta.dir, 'typecheck-single-error', (_, sources) => {
    const rawJson = Object.values(sources)[0] ?? '';

    try {
      return pullDiagnosticsToItems(JSON.parse(rawJson) as unknown);
    } catch {
      return [];
    }
  });

  runGolden(import.meta.dir, 'typecheck-warning', (_, sources) => {
    const rawJson = Object.values(sources)[0] ?? '';

    try {
      return pullDiagnosticsToItems(JSON.parse(rawJson) as unknown);
    } catch {
      return [];
    }
  });

  runGolden(import.meta.dir, 'typecheck-mixed', (_, sources) => {
    const rawJson = Object.values(sources)[0] ?? '';

    try {
      return pullDiagnosticsToItems(JSON.parse(rawJson) as unknown);
    } catch {
      return [];
    }
  });
});
