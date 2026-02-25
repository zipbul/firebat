import { describe, expect, it } from 'bun:test';
import * as path from 'node:path';

import { parseArgs } from './arg-parse';

describe('arg-parse', () => {
  it('should return default options when no args are provided', () => {
    // Arrange
    let argv: string[] = [];
    // Act
    let result = parseArgs(argv);

    // Assert
    expect(result.targets).toEqual([]);
    expect(result.format).toBe('text');
    expect(result.minSize).toBe('auto');
    expect(result.maxForwardDepth).toBe(0);
    expect(result.exitOnFindings).toBe(true);
    expect(result.detectors).toEqual([
      'exact-duplicates',
      'waste',
      'barrel-policy',
      'unknown-proof',
      'exception-hygiene',
      'format',
      'lint',
      'typecheck',
      'dependencies',
      'coupling',
      'structural-duplicates',
      'nesting',
      'early-return',
      'forwarding',
      'implicit-state',
      'temporal-coupling',
      'symmetry-breaking',
      'invariant-blindspot',
      'modification-trap',
      'modification-impact',
      'variable-lifetime',
      'decision-surface',
      'implementation-overhead',
      'concept-scatter',
      'abstraction-fitness',
      'giant-file',
    ]);
    expect(result.fix).toBe(false);
    expect(result.help).toBe(false);
    expect(result.explicit).toBeDefined();
  });

  it('should return help mode with defaults when help flag is provided', () => {
    // Arrange
    let argv = ['--help'];
    // Act
    let result = parseArgs(argv);

    // Assert
    expect(result.help).toBe(true);
    expect(result.targets).toEqual([]);
    expect(result.format).toBe('text');
    expect(result.minSize).toBe('auto');
    expect(result.maxForwardDepth).toBe(0);
    expect(result.exitOnFindings).toBe(true);
    expect(result.detectors).toEqual([
      'exact-duplicates',
      'waste',
      'barrel-policy',
      'unknown-proof',
      'exception-hygiene',
      'format',
      'lint',
      'typecheck',
      'dependencies',
      'coupling',
      'structural-duplicates',
      'nesting',
      'early-return',
      'forwarding',
      'implicit-state',
      'temporal-coupling',
      'symmetry-breaking',
      'invariant-blindspot',
      'modification-trap',
      'modification-impact',
      'variable-lifetime',
      'decision-surface',
      'implementation-overhead',
      'concept-scatter',
      'abstraction-fitness',
      'giant-file',
    ]);
    expect(result.fix).toBe(false);
    expect(result.explicit).toBeDefined();
  });

  it('should parse format, minSize, and targets when options are provided', () => {
    // Arrange
    let argv = ['--format', 'json', '--min-size', '120', '--max-forward-depth', '2', 'packages'];
    // Act
    let result = parseArgs(argv);

    // Assert
    expect(result.format).toBe('json');
    expect(result.minSize).toBe(120);
    expect(result.maxForwardDepth).toBe(2);
    expect(result.targets).toEqual([path.resolve('packages')]);
    expect(result.detectors).toEqual([
      'exact-duplicates',
      'waste',
      'barrel-policy',
      'unknown-proof',
      'exception-hygiene',
      'format',
      'lint',
      'typecheck',
      'dependencies',
      'coupling',
      'structural-duplicates',
      'nesting',
      'early-return',
      'forwarding',
      'implicit-state',
      'temporal-coupling',
      'symmetry-breaking',
      'invariant-blindspot',
      'modification-trap',
      'modification-impact',
      'variable-lifetime',
      'decision-surface',
      'implementation-overhead',
      'concept-scatter',
      'abstraction-fitness',
      'giant-file',
    ]);
    expect(result.fix).toBe(false);
    expect(result.help).toBe(false);
    expect(result.explicit).toBeDefined();
  });

  it('should enable fix mode when --fix is provided', () => {
    // Arrange
    let argv = ['--fix'];
    // Act
    let result = parseArgs(argv);

    // Assert
    expect(result.fix).toBe(true);
    expect(result.explicit?.fix).toBe(true);
  });

  it('should parse detectors when --only is provided', () => {
    // Arrange
    let argv = ['--only', 'waste', 'packages'];
    // Act
    let result = parseArgs(argv);

    // Assert
    expect(result.detectors).toEqual(['waste']);
  });

  it('should parse P1 detectors when --only is provided', () => {
    // Arrange
    let argv = ['--only', 'decision-surface', 'packages'];
    // Act
    let result = parseArgs(argv);

    // Assert
    expect(result.detectors).toEqual(['decision-surface']);
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
