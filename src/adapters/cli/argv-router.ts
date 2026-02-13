export type FirebatSubcommand = 'install' | 'update' | 'cache' | 'mcp' | 'scan' | undefined;

export type FirebatGlobalLogOptions = {
  readonly logLevel?: string;
  readonly logStack: boolean;
};

export type FirebatArgvRoute = {
  readonly subcommand: FirebatSubcommand;
  readonly global: FirebatGlobalLogOptions;
  readonly scanArgv: ReadonlyArray<string>;
  readonly subcommandArgv: ReadonlyArray<string>;
};

const parseGlobalLogOptions = (argv: readonly string[]): FirebatGlobalLogOptions => {
  let logLevel: string | undefined;
  let logStack = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';

    if (arg === '--log-stack') {
      logStack = true;

      continue;
    }

    if (arg === '--log-level') {
      const value = argv[i + 1];

      if (typeof value === 'string' && value.length > 0) {
        logLevel = value;
      }

      i += 1;

      continue;
    }

    if (arg.startsWith('--log-level=')) {
      const value = arg.slice('--log-level='.length);

      if (value.length > 0) {
        logLevel = value;
      }
    }
  }

  if (logLevel === undefined) {
    return { logStack };
  }

  return { logLevel, logStack };
};

const isCommandToken = (token: string): token is Exclude<FirebatSubcommand, undefined> | 'i' | 'u' => {
  return token === 'scan' || token === 'install' || token === 'i' || token === 'update' || token === 'u' || token === 'cache' || token === 'mcp';
};

const normalizeSubcommand = (token: string): FirebatSubcommand => {
  if (token === 'i') {
    return 'install';
  }

  if (token === 'u') {
    return 'update';
  }

  if (token === 'scan' || token === 'install' || token === 'update' || token === 'cache' || token === 'mcp') {
    return token;
  }

  return undefined;
};

const findSubcommandIndex = (argv: readonly string[]): number | null => {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';

    if (arg === '--log-level') {
      i += 1;

      continue;
    }

    if (arg.startsWith('--log-level=')) {
      continue;
    }

    if (arg === '--log-stack') {
      continue;
    }

    if (arg.startsWith('-')) {
      continue;
    }

    if (isCommandToken(arg)) {
      return i;
    }
  }

  return null;
};

const stripGlobalLogFlags = (argv: readonly string[]): string[] => {
  const out: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';

    if (arg === '--log-stack') {
      continue;
    }

    if (arg === '--log-level') {
      i += 1;

      continue;
    }

    if (arg.startsWith('--log-level=')) {
      continue;
    }

    out.push(arg);
  }

  return out;
};

export const routeFirebatArgv = (argv: readonly string[]): FirebatArgvRoute => {
  const global = parseGlobalLogOptions(argv);
  const subcommandIndex = findSubcommandIndex(argv);
  const subcommandToken = subcommandIndex === null ? undefined : argv[subcommandIndex];
  const subcommand = subcommandToken ? normalizeSubcommand(subcommandToken) : undefined;

  const scanArgv =
    subcommandIndex !== null && normalizeSubcommand(subcommandToken ?? '') === 'scan'
      ? argv.filter((_, idx) => idx !== subcommandIndex)
      : argv;

  const subcommandArgv =
    subcommandIndex === null ? [] : stripGlobalLogFlags(argv.filter((_, idx) => idx !== subcommandIndex));

  return {
    subcommand,
    global,
    scanArgv,
    subcommandArgv,
  };
};
