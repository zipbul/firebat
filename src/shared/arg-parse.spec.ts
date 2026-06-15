import { describe, expect, it } from 'bun:test';
import * as path from 'node:path';

import type { FirebatDetector } from '../types';

import { parseArgs } from './arg-parse';

interface ParsedDefaults {
  targets: string[];
  minSize: 'auto' | number;
  maxForwardDepth: number;
  help: boolean;
}

// Expected default detector list, hardcoded here so the assertion is independent
// of the production constant (importing it would make the test tautological).
const EXPECTED_DEFAULT_DETECTORS: FirebatDetector[] = [
  'duplicates',
  'waste',
  'barrel',
  'error-flow',
  'format',
  'lint',
  'typecheck',
  'dependencies',
  'coupling',
  'nesting',
  'early-return',
  'collapsible-if',
  'indirection',
  'temporal-coupling',
  'variable-lifetime',
  'giant-file',
];

describe('arg-parse', () => {
  it.each<[string, string[], ParsedDefaults]>([
    ['no args are provided', [], { targets: [], minSize: 'auto', maxForwardDepth: 0, help: false }],
    ['help flag is provided', ['--help'], { targets: [], minSize: 'auto', maxForwardDepth: 0, help: true }],
    [
      'min-size, max-forward-depth and a target are provided',
      ['--min-size', '120', '--max-forward-depth', '2', 'packages'],
      { targets: [path.resolve('packages')], minSize: 120, maxForwardDepth: 2, help: false },
    ],
  ])('should keep default detectors and parse options when %s', (_label, argv, expected) => {
    // Act
    const result = parseArgs(argv);

    // Assert
    expect(result.targets).toEqual(expected.targets);
    expect(result.minSize).toBe(expected.minSize);
    expect(result.maxForwardDepth).toBe(expected.maxForwardDepth);
    expect(result.detectors).toEqual(EXPECTED_DEFAULT_DETECTORS);
    expect(result.help).toBe(expected.help);
    expect(result.explicit).toBeDefined();
  });

  it.each<[string, string[], FirebatDetector[]]>([
    ['a single detector is selected', ['--only', 'waste', 'packages'], ['waste']],
    ['a P1 detector is selected', ['--only', 'temporal-coupling', 'packages'], ['temporal-coupling']],
  ])('should parse only the requested detectors when %s', (_label, argv, expectedDetectors) => {
    // Act
    const result = parseArgs(argv);

    // Assert
    expect(result.detectors).toEqual(expectedDetectors);
  });

  it('should parse configPath and logLevel when provided', () => {
    // Arrange
    let argv = ['--config', './.firebatrc.jsonc', '--log-level', 'warn'];
    // Act
    let result = parseArgs(argv);

    // Assert
    expect(result.configPath).toBe(path.resolve('./.firebatrc.jsonc'));
    expect(result.logLevel).toBe('warn');
    expect(result.explicit?.configPath).toBe(true);
    expect(result.explicit?.logLevel).toBe(true);
  });

  it('should parse logStack when provided', () => {
    // Arrange
    let argv = ['--log-stack'];
    // Act
    let result = parseArgs(argv);

    // Assert
    expect(result.logStack).toBe(true);
    expect(result.explicit?.logStack).toBe(true);
  });

  it('should throw a validation error when an unknown option is provided', () => {
    // Arrange
    let argv = ['--nope'];

    // Act
    let act = () => parseArgs(argv);

    // Assert
    expect(act).toThrow('[firebat] Unknown option: --nope');
  });
});
