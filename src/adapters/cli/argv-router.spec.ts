import { describe, expect, test } from 'bun:test';

import { routeFirebatArgv } from './argv-router';

interface UpdateRouteRow {
  name: string;
  argv: string[];
  logLevel: string;
  logStack: boolean;
  subcommandArgv: string[];
}

describe('argv-router', () => {
  const updateRouteRows: UpdateRouteRow[] = [
    {
      name: 'should route to update when global flags precede command',
      argv: ['--log-level', 'trace', 'update'],
      logLevel: 'trace',
      logStack: false,
      subcommandArgv: [],
    },
    {
      name: 'should strip global log flags from update argv',
      argv: ['update', '--log-level=debug', '--log-stack', '--yes'],
      logLevel: 'debug',
      logStack: true,
      subcommandArgv: ['--yes'],
    },
  ];

  test.each(updateRouteRows)('$name', ({ argv, logLevel, logStack, subcommandArgv }) => {
    // Act
    const result = routeFirebatArgv(argv);

    // Assert
    expect(result.subcommand).toBe('update');
    expect(result.global.logLevel).toBe(logLevel);
    expect(result.global.logStack).toBe(logStack);
    expect(result.subcommandArgv).toEqual(subcommandArgv);
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
