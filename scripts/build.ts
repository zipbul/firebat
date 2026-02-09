import { Glob } from 'bun';
import * as path from 'node:path';

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

interface Logger {
  trace: (message: string, meta?: Record<string, unknown>) => void;
  debug: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
}

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m',
} as const;
const LEVEL_PRIORITY: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
};
const LEVEL_EMOJI: Record<LogLevel, string> = {
  trace: '🔍',
  debug: '🐛',
  info: '📦',
  warn: '⚠️',
  error: '❌',
};
const LEVEL_COLOR: Record<LogLevel, string> = {
  trace: ANSI.gray,
  debug: ANSI.cyan,
  info: ANSI.cyan,
  warn: ANSI.yellow,
  error: ANSI.red,
};

const createLogger = (minLevel: LogLevel): Logger => {
  const minPriority = LEVEL_PRIORITY[minLevel];

  const log = (level: LogLevel, message: string, meta?: Record<string, unknown>): void => {
    if (LEVEL_PRIORITY[level] < minPriority) {
      return;
    }

    const emoji = LEVEL_EMOJI[level];
    const color = LEVEL_COLOR[level];
    const levelLabel = level.toUpperCase().padEnd(5);
    const metaStr = meta && Object.keys(meta).length > 0 ? ` ${ANSI.dim}${JSON.stringify(meta)}${ANSI.reset}` : '';

    console.log(`${emoji}  ${color}${ANSI.bold}${levelLabel}${ANSI.reset} ${color}${message}${ANSI.reset}${metaStr}`);
  };

  return {
    trace: (msg, meta) => log('trace', msg, meta),
    debug: (msg, meta) => log('debug', msg, meta),
    info: (msg, meta) => log('info', msg, meta),
    warn: (msg, meta) => log('warn', msg, meta),
    error: (msg, meta) => log('error', msg, meta),
  };
};

const parseLogLevel = (args: string[]): LogLevel => {
  const idx = args.indexOf('--log-level');

  if (idx === -1 || idx === args.length - 1) {
    return 'info';
  }

  const value = args[idx + 1];

  if (!value || !(value in LEVEL_PRIORITY)) {
    return 'info';
  }

  return value as LogLevel;
};

type ThirdPartyPackageInfo = {
  name: string;
  version: string | null;
  declaredLicense: string | null;
  licenseFilePath: string | null;
  noticeFilePath: string | null;
  homepage: string | null;
  repositoryUrl: string | null;
};

const resolveRepositoryUrl = (repository: unknown): string | null => {
  if (typeof repository === 'string') {
    return repository;
  }

  if (!repository || typeof repository !== 'object') {
    return null;
  }

  const url = (repository as { url?: unknown }).url;

  return typeof url === 'string' ? url : null;
};

const fileExists = async (filePath: string): Promise<boolean> => {
  return Bun.file(filePath).exists();
};

const readTextFile = async (filePath: string): Promise<string> => {
  return Bun.file(filePath).text();
};

const findFileByPrefix = async (dirPath: string, prefixUppercase: string): Promise<string | null> => {
  try {
    const glob = new Glob('*');

    for await (const entry of glob.scan(dirPath)) {
      const base = path.basename(entry);

      if (base.toUpperCase().startsWith(prefixUppercase)) {
        return entry;
      }
    }

    return null;
  } catch {
    return null;
  }
};

const tryReadText = async (filePath: string | null): Promise<string | null> => {
  if (!filePath) {
    return null;
  }

  try {
    return await readTextFile(filePath);
  } catch {
    return null;
  }
};

const getApache20TextFromInstalledDeps = async (): Promise<string | null> => {
  const candidates = ['node_modules/@typescript/native-preview/LICENSE', 'node_modules/fastbitset/LICENSE'];

  for (const candidate of candidates) {
    const text = await tryReadText(candidate);

    if (text && text.trim().startsWith('Apache License')) {
      return text;
    }
  }

  return null;
};

const collectThirdPartyNotices = async (): Promise<{ packages: ThirdPartyPackageInfo[]; apache20Text: string | null }> => {
  const rootPackageJson = (await Bun.file('package.json').json()) as {
    dependencies?: Record<string, string>;
  };
  const dependencyNames = Object.keys(rootPackageJson.dependencies ?? {}).sort();
  const packages: ThirdPartyPackageInfo[] = [];

  for (const name of dependencyNames) {
    const pkgDir = path.join('node_modules', ...name.split('/'));
    const pkgJsonPath = path.join(pkgDir, 'package.json');
    const meta = (await fileExists(pkgJsonPath))
      ? ((await Bun.file(pkgJsonPath).json()) as {
          version?: string;
          license?: string;
          homepage?: string;
          repository?: unknown;
        })
      : null;
    const licenseCandidates = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md', 'LICENCE.txt', 'COPYING'].map(n =>
      path.join(pkgDir, n),
    );
    const noticeCandidates = ['NOTICE', 'NOTICE.txt', 'NOTICE.md'].map(n => path.join(pkgDir, n));
    let licenseFilePath: string | null = null;

    for (const candidate of licenseCandidates) {
      if (await fileExists(candidate)) {
        licenseFilePath = candidate;

        break;
      }
    }
    if (!licenseFilePath) {
      licenseFilePath = await findFileByPrefix(pkgDir, 'LICENSE');

      if (licenseFilePath && !(await fileExists(licenseFilePath))) {
        licenseFilePath = null;
      }
    }

    let noticeFilePath: string | null = null;

    for (const candidate of noticeCandidates) {
      if (await fileExists(candidate)) {
        noticeFilePath = candidate;

        break;
      }
    }
    if (!noticeFilePath) {
      noticeFilePath = await findFileByPrefix(pkgDir, 'NOTICE');

      if (noticeFilePath && !(await fileExists(noticeFilePath))) {
        noticeFilePath = null;
      }
    }

    packages.push({
      name,
      version: meta?.version ?? null,
      declaredLicense: meta?.license ?? null,
      licenseFilePath,
      noticeFilePath,
      homepage: meta?.homepage ?? null,
      repositoryUrl: resolveRepositoryUrl(meta?.repository),
    });
  }

  return { packages, apache20Text: await getApache20TextFromInstalledDeps() };
};

const formatThirdPartyNotices = async (input: {
  packages: ThirdPartyPackageInfo[];
  apache20Text: string | null;
}): Promise<string> => {
  const lines: string[] = [];

  lines.push('THIRD-PARTY NOTICES');
  lines.push('');
  lines.push('Generated by scripts/build.ts at build time.');
  lines.push('Scope: direct runtime dependencies from package.json (dependencies).');
  lines.push('');

  for (const pkg of input.packages) {
    lines.push('='.repeat(80));
    lines.push(`PACKAGE: ${pkg.name}${pkg.version ? `@${pkg.version}` : ''}`);
    lines.push(`DECLARED LICENSE: ${pkg.declaredLicense ?? '<missing>'}`);

    if (pkg.homepage) {
      lines.push(`HOMEPAGE: ${pkg.homepage}`);
    }

    if (pkg.repositoryUrl) {
      lines.push(`REPOSITORY: ${pkg.repositoryUrl}`);
    }

    lines.push('-'.repeat(80));

    const licenseText = await tryReadText(pkg.licenseFilePath);

    if (licenseText) {
      lines.push(`LICENSE FILE: ${pkg.licenseFilePath}`);
      lines.push(licenseText.trimEnd());
      lines.push('');
    } else if ((pkg.declaredLicense ?? '').toUpperCase() === 'APACHE-2.0') {
      if (!input.apache20Text) {
        throw new Error(
          `Could not locate Apache-2.0 license text to include for ${pkg.name}. ` +
            `Expected to find it in installed deps (e.g. node_modules/@typescript/native-preview/LICENSE).`,
        );
      }

      lines.push('LICENSE FILE: <missing in package; using Apache-2.0 text from installed deps>');
      lines.push(input.apache20Text.trimEnd());
      lines.push('');
    } else {
      throw new Error(
        `Missing LICENSE file for dependency ${pkg.name} (declared license: ${pkg.declaredLicense ?? '<missing>'}).`,
      );
    }

    const noticeText = await tryReadText(pkg.noticeFilePath);

    if (noticeText) {
      lines.push(`NOTICE FILE: ${pkg.noticeFilePath}`);
      lines.push(noticeText.trimEnd());
      lines.push('');
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
};

const runBuild = async (logger: Logger): Promise<void> => {
  const outdir = 'dist';

  logger.info('🔥 firebat:build starting...');
  logger.debug('Build configuration', { outdir, target: 'bun', minify: true });

  const cliNaming = 'firebat.js';
  const cliDistFilePath = `${outdir}/${cliNaming}`;

  logger.trace('Building CLI entrypoint', { entry: 'index.ts', output: cliDistFilePath });

  const cliBuildResult = await Bun.build({
    entrypoints: ['index.ts'],
    outdir,
    target: 'bun',
    minify: true,
    sourcemap: 'inline',
    packages: 'external',
    banner: '#!/usr/bin/env bun\n',
    naming: cliNaming,
  });

  if (cliBuildResult.logs.length > 0) {
    logger.trace('CLI build logs:', { logs: cliBuildResult.logs });
  }

  logger.debug('CLI build completed', { success: cliBuildResult.success, outputs: cliBuildResult.outputs.length });
  logger.trace('Building oxlint plugin', { entry: 'oxlint-plugin.ts' });

  const pluginBuildResult = await Bun.build({
    entrypoints: ['oxlint-plugin.ts'],
    outdir,
    target: 'bun',
    minify: true,
    sourcemap: 'inline',
    packages: 'external',
    naming: 'oxlint-plugin.js',
  });

  if (pluginBuildResult.logs.length > 0) {
    logger.trace('Plugin build logs:', { logs: pluginBuildResult.logs });
  }

  logger.debug('Plugin build completed', { success: pluginBuildResult.success, outputs: pluginBuildResult.outputs.length });

  if (!cliBuildResult.success || !pluginBuildResult.success) {
    logger.error('Build failed', { cliSuccess: cliBuildResult.success, pluginSuccess: pluginBuildResult.success });

    const allLogs = [...cliBuildResult.logs, ...pluginBuildResult.logs];

    if (allLogs.length > 0) {
      logger.error('Build logs:', { logs: allLogs });
    }

    process.exit(1);
  }

  logger.info('Build artifacts created successfully');

  logger.trace('Setting executable permissions', { file: cliDistFilePath });

  const chmodResult = Bun.spawnSync(['chmod', '755', cliDistFilePath]);

  if (chmodResult.exitCode !== 0) {
    logger.error('chmod failed', { exitCode: chmodResult.exitCode, file: cliDistFilePath });

    process.exit(1);
  }

  logger.debug('Executable permissions set', { file: cliDistFilePath });

  // NOTE: Drizzle migrator expects migrationsFolder/meta/_journal.json at runtime.
  // We ship migrations as packaged, read-only assets next to dist/*.js.
  logger.trace('Copying migrations to dist');

  try {
    const migrationsSrcDirPath = 'src/infrastructure/sqlite/migrations';
    const migrationsDistDirPath = `${outdir}/migrations`;

    logger.trace('Cleaning old migrations', { path: migrationsDistDirPath });
    await Bun.$`rm -rf ${migrationsDistDirPath}`;
    await Bun.$`mkdir -p ${migrationsDistDirPath}`;
    logger.trace('Copying migration files', { from: migrationsSrcDirPath, to: migrationsDistDirPath });
    await Bun.$`cp -R ${migrationsSrcDirPath}/. ${migrationsDistDirPath}/`;

    logger.debug('Migrations copied successfully', { destination: migrationsDistDirPath });
  } catch (error) {
    logger.error('Failed to copy migrations into dist/', { error: String(error) });

    process.exit(1);
  }

  logger.trace('Generating THIRD_PARTY_NOTICES.txt');

  try {
    const { packages, apache20Text } = await collectThirdPartyNotices();

    logger.debug('Collected third-party package info', { packagesCount: packages.length });

    const content = await formatThirdPartyNotices({ packages, apache20Text });
    const outPath = `${outdir}/THIRD_PARTY_NOTICES.txt`;

    await Bun.write(outPath, content);

    logger.debug('THIRD_PARTY_NOTICES.txt written', { path: outPath, size: content.length });
  } catch (error) {
    logger.error('Failed to generate THIRD_PARTY_NOTICES.txt', { error: String(error) });

    process.exit(1);
  }

  logger.info('🔥 firebat:build complete!');
};

const logLevel = parseLogLevel(process.argv.slice(2));
const logger = createLogger(logLevel);

void runBuild(logger);
