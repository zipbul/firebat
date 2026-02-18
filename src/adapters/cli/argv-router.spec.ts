import { describe, expect, test } from 'bun:test';

import { routeFirebatArgv } from './argv-router';

describe('argv-router', () => {
  test('should route to update when global flags precede command', () => {
    // Arrange
    const argv = ['--log-level', 'trace', 'update'];
    // Act
    const result = routeFirebatArgv(argv);

    // Assert
    expect(result.subcommand).toBe('update');
    expect(result.global.logLevel).toBe('trace');
    expect(result.global.logStack).toBe(false);
    expect(result.subcommandArgv).toEqual([]);
  });

  test('should strip global log flags from update argv', () => {
    // Arrange
    const argv = ['update', '--log-level=debug', '--log-stack', '--yes'];
    // Act
    const result = routeFirebatArgv(argv);

    // Assert
    expect(result.subcommand).toBe('update');
    expect(result.global.logLevel).toBe('debug');
    expect(result.global.logStack).toBe(true);
    expect(result.subcommandArgv).toEqual(['--yes']);
  });

  test('should route to scan when explicit scan appears after global flags', () => {
    // Arrange
    const argv = ['--log-stack', 'scan', 'src'];
    // Act
    const result = routeFirebatArgv(argv);

    // Assert
    expect(result.subcommand).toBe('scan');
    expect(result.scanArgv).toEqual(['--log-stack', 'src']);
  });

  test('should treat argv as scan when no subcommand is present', () => {
    // Arrange
    const argv = ['--log-level', 'info', 'src'];
    // Act
    const result = routeFirebatArgv(argv);

    // Assert
    expect(result.subcommand).toBe(undefined);
    expect(result.scanArgv).toEqual(argv);
    expect(result.subcommandArgv).toEqual([]);
  });

  test('should route to cache when cache command is present', () => {
    // Arrange
    const argv = ['--log-level', 'trace', 'cache', 'clean'];
    // Act
    const result = routeFirebatArgv(argv);

    // Assert
    expect(result.subcommand).toBe('cache');
    expect(result.subcommandArgv).toEqual(['clean']);
  });
});
