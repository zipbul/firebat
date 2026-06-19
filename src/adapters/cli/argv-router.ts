type FirebatSubcommand = 'install' | 'update' | 'cache' | 'scan' | undefined;

type FirebatGlobalLogOptions = {
  readonly logLevel?: string;
  readonly logStack: boolean;
};

type FirebatArgvRoute = {
  readonly subcommand: FirebatSubcommand;
  readonly global: FirebatGlobalLogOptions;
  readonly scanArgv: ReadonlyArray<string>;
  readonly subcommandArgv: ReadonlyArray<string>;
};

const extractLogLevelFromFlag = (arg: string, nextArg: string | undefined): { value: string | undefined; skip: boolean } => {
  if (arg === '--log-level') {
    const value = typeof nextArg === 'string' && nextArg.length > 0 ? nextArg : undefined;

    return { value, skip: true };
  }

  if (arg.startsWith('--log-level=')) {
    const value = arg.slice('--log-level='.length);

    return { value: value.length > 0 ? value : undefined, skip: false };
  }

  return { value: undefined, skip: false };
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

    const { value, skip } = extractLogLevelFromFlag(arg, argv[i + 1]);

    if (value !== undefined) {
      logLevel = value;
    }

    if (skip) {
      i += 1;
    }
  }

  if (logLevel === undefined) {
    return { logStack };
  }

  return { logLevel, logStack };
};

const isCommandToken = (token: string): token is Exclude<FirebatSubcommand, undefined> | 'i' | 'u' => {
  return token === 'scan' || token === 'install' || token === 'i' || token === 'update' || token === 'u' || token === 'cache';
};

const normalizeSubcommand = (token: string): FirebatSubcommand => {
  if (token === 'i') {
    return 'install';
  }

  if (token === 'u') {
    return 'update';
  }

  if (token === 'scan' || token === 'install' || token === 'update' || token === 'cache') {
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
  const argvWithoutSubcommand = subcommandIndex === null ? argv : argv.filter((_, idx) => idx !== subcommandIndex);
  const scanArgv =
    subcommandIndex !== null && normalizeSubcommand(subcommandToken ?? '') === 'scan' ? argvWithoutSubcommand : argv;
  const subcommandArgv = subcommandIndex === null ? [] : stripGlobalLogFlags(argvWithoutSubcommand);

  return {
    subcommand,
    global,
    scanArgv,
    subcommandArgv,
  };
};
