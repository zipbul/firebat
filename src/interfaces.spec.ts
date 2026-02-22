import { describe, it, expect } from 'bun:test';
import type {
  FirebatCliExplicitFlags,
  FirebatCliOptions,
  FirebatProgramConfig,
} from './interfaces';
import { createNoopLogger } from './ports/logger';

describe('FirebatCliExplicitFlags', () => {
  it('should satisfy all boolean fields when assigned', () => {
    const flags: FirebatCliExplicitFlags = {
      format: true,
      minSize: false,
      maxForwardDepth: true,
      exitOnFindings: false,
      detectors: true,
      fix: false,
      configPath: true,
      logLevel: false,
      logStack: true,
    };

    expect(typeof flags.format).toBe('boolean');
    expect(typeof flags.minSize).toBe('boolean');
    expect(typeof flags.maxForwardDepth).toBe('boolean');
    expect(typeof flags.exitOnFindings).toBe('boolean');
    expect(typeof flags.detectors).toBe('boolean');
    expect(typeof flags.fix).toBe('boolean');
    expect(typeof flags.configPath).toBe('boolean');
    expect(typeof flags.logLevel).toBe('boolean');
    expect(typeof flags.logStack).toBe('boolean');
  });
});

describe('FirebatCliOptions', () => {
  it('should satisfy required fields when assigned', () => {
    const opts: FirebatCliOptions = {
      targets: ['/src'],
      format: 'text',
      minSize: 5,
      maxForwardDepth: 2,
      exitOnFindings: false,
      detectors: ['waste'],
      fix: false,
      help: false,
    };

    expect(opts.targets).toEqual(['/src']);
    expect(opts.format).toBe('text');
    expect(opts.minSize).toBe(5);
    expect(opts.maxForwardDepth).toBe(2);
    expect(opts.exitOnFindings).toBe(false);
    expect(opts.detectors).toEqual(['waste']);
    expect(opts.fix).toBe(false);
    expect(opts.help).toBe(false);
  });

  it('should accept undefined for all optional fields when assigned', () => {
    const opts: FirebatCliOptions = {
      targets: [],
      format: 'json',
      minSize: 'auto',
      maxForwardDepth: 0,
      exitOnFindings: true,
      detectors: [],
      fix: false,
      help: false,
      // all optional fields omitted
    };

    expect(opts.unknownProofBoundaryGlobs).toBeUndefined();
    expect(opts.barrelPolicyIgnoreGlobs).toBeUndefined();
    expect(opts.dependenciesLayers).toBeUndefined();
    expect(opts.dependenciesAllowedDependencies).toBeUndefined();
    expect(opts.configPath).toBeUndefined();
    expect(opts.logLevel).toBeUndefined();
    expect(opts.logStack).toBeUndefined();
    expect(opts.explicit).toBeUndefined();
    expect(opts.wasteMemoryRetentionThreshold).toBeUndefined();
  });

  it('should accept empty array targets when assigned', () => {
    const opts: FirebatCliOptions = {
      targets: [],
      format: 'text',
      minSize: 0,
      maxForwardDepth: 0,
      exitOnFindings: false,
      detectors: [],
      fix: false,
      help: false,
    };

    expect(opts.targets).toHaveLength(0);
  });

  it('should accept undefined explicit when assigned without it', () => {
    const opts: FirebatCliOptions = {
      targets: ['src'],
      format: 'text',
      minSize: 4,
      maxForwardDepth: 1,
      exitOnFindings: false,
      detectors: [],
      fix: false,
      help: true,
    };

    expect(opts.explicit).toBeUndefined();
  });
});

describe('FirebatProgramConfig', () => {
  it('should satisfy targets and logger shape when assigned', () => {
    const config: FirebatProgramConfig = {
      targets: ['/project/src'],
      logger: createNoopLogger('error'),
    };

    expect(config.targets).toEqual(['/project/src']);
    expect(typeof config.logger.info).toBe('function');
    expect(typeof config.logger.error).toBe('function');
  });
});
