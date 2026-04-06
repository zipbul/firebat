import { describe, it, expect } from 'bun:test';

import type { FirebatCliExplicitFlags, FirebatCliOptions, FirebatProgramConfig } from './interfaces';

import { createNoopLogger } from './shared/logger';

describe('FirebatCliExplicitFlags', () => {
  it('should satisfy all boolean fields when assigned', () => {
    const flags: FirebatCliExplicitFlags = {
      minSize: false,
      maxForwardDepth: true,
      crossFileMinDepth: false,
      detectors: true,
      configPath: true,
      logLevel: false,
      logStack: true,
    };

    expect(typeof flags.minSize).toBe('boolean');
    expect(typeof flags.maxForwardDepth).toBe('boolean');
    expect(typeof flags.detectors).toBe('boolean');
    expect(typeof flags.configPath).toBe('boolean');
    expect(typeof flags.logLevel).toBe('boolean');
    expect(typeof flags.logStack).toBe('boolean');
  });
});

describe('FirebatCliOptions', () => {
  it('should satisfy required fields when assigned', () => {
    const opts: FirebatCliOptions = {
      targets: ['/src'],
      minSize: 5,
      maxForwardDepth: 2,
      detectors: ['waste'],
      help: false,
    };

    expect(opts.targets).toEqual(['/src']);
    expect(opts.minSize).toBe(5);
    expect(opts.maxForwardDepth).toBe(2);
    expect(opts.detectors).toEqual(['waste']);
    expect(opts.help).toBe(false);
  });

  it('should accept undefined for all optional fields when assigned', () => {
    const opts: FirebatCliOptions = {
      targets: [],
      minSize: 'auto',
      maxForwardDepth: 0,
      detectors: [],
      help: false,
      // all optional fields omitted
    };

    expect(opts.barrelIgnoreGlobs).toBeUndefined();
    expect(opts.dependenciesLayers).toBeUndefined();
    expect(opts.dependenciesAllowedDependencies).toBeUndefined();
    expect(opts.configPath).toBeUndefined();
    expect(opts.logLevel).toBeUndefined();
    expect(opts.logStack).toBeUndefined();
    expect(opts.explicit).toBeUndefined();
  });

  it('should accept empty array targets when assigned', () => {
    const opts: FirebatCliOptions = {
      targets: [],
      minSize: 0,
      maxForwardDepth: 0,
      detectors: [],
      help: false,
    };

    expect(opts.targets).toHaveLength(0);
  });

  it('should accept undefined explicit when assigned without it', () => {
    const opts: FirebatCliOptions = {
      targets: ['src'],
      minSize: 4,
      maxForwardDepth: 1,
      detectors: [],
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
