import { mkdir, rename } from 'node:fs/promises';
import * as path from 'node:path';

import type { FirebatLogger } from '../../ports/logger';

import { getOrmDb } from '../../infrastructure/sqlite/firebat.db';
import { resolveRuntimeContextFromCwd } from '../../shared/runtime-context';
import { syncJsoncTextToTemplateKeys } from './firebatrc-jsonc-sync';
import { loadFirstExistingText, resolveAssetCandidates } from './install-assets';

interface JsonObject {
  readonly [key: string]: JsonValue;
}

type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;

interface AssetTemplateMeta {
  readonly sourcePath: string;
  readonly sha256: string;
}

interface AssetInstallInstalled {
  readonly kind: 'installed';
  readonly filePath: string;
  readonly desiredSha256: string;
}

interface AssetInstallSkippedSame {
  readonly kind: 'skipped-exists-same';
  readonly filePath: string;
  readonly desiredSha256: string;
  readonly existingSha256: string;
}

interface AssetInstallSkippedDifferent {
  readonly kind: 'skipped-exists-different';
  readonly filePath: string;
  readonly desiredSha256: string;
  readonly existingSha256: string;
}

type AssetInstallResult = AssetInstallInstalled | AssetInstallSkippedSame | AssetInstallSkippedDifferent;

const sha256Hex = async (text: string): Promise<string> => {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const arr = Array.from(new Uint8Array(digest));

  return arr.map(b => b.toString(16).padStart(2, '0')).join('');
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const failJsonValue = (message: string): never => {
  throw new Error(message);
};

const toJsonValue = (value: unknown): JsonValue => {
  if (value === undefined) {
    return failJsonValue('[firebat] Invalid JSON value (undefined)');
  }

  let out: JsonValue;

  if (value === null) {
    out = null;
  } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    out = value;
  } else if (Array.isArray(value)) {
    out = value.map(item => toJsonValue(item));
  } else if (isPlainObject(value)) {
    const obj: Record<string, JsonValue> = {};

    for (const [k, v] of Object.entries(value)) {
      obj[k] = toJsonValue(v);
    }

    out = obj;
  } else {
    return failJsonValue('[firebat] Invalid JSON value (non-JSON type encountered)');
  }

  return out;
};

const sortJsonValue = (value: JsonValue): JsonValue => {
  if (value === null) {
    return null;
  }

  let out: JsonValue;

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    out = value;
  } else if (Array.isArray(value)) {
    out = value.map(v => sortJsonValue(v));
  } else {
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    const obj: Record<string, JsonValue> = {};

    for (const [k, v] of entries) {
      obj[k] = sortJsonValue(v);
    }

    out = obj;
  }

  return out;
};

const jsonText = (value: JsonValue): string => JSON.stringify(sortJsonValue(value), null, 2) + '\n';

const writeFileAtomic = async (filePath: string, text: string): Promise<void> => {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmpPath = path.join(dir, `.${base}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`);

  await Bun.write(tmpPath, text);
  await rename(tmpPath, filePath);
};

const parseJsoncOrThrow = (filePath: string, text: string): JsonValue => {
  if (text.trim().length === 0) {
    return failJsonValue(`[firebat] Failed to parse JSONC: ${filePath}: empty input`);
  }

  try {
    return toJsonValue(Bun.JSONC.parse(text));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    throw new Error(`[firebat] Failed to parse JSONC: ${filePath}: ${msg}`);
  }
};

interface ParseYesResult {
  yes: boolean;
  help: boolean;
}

interface EnsureBaseSnapshotInput {
  readonly rootAbs: string;
  readonly firebatDir: string;
  readonly assetFileName: string;
  readonly templateText: string;
}

interface EnsureBaseSnapshotResult {
  sha256: string;
  filePath: string;
}

interface BaseSnapshot {
  sha256: string;
  filePath: string;
}

interface LoadedTemplate {
  asset: string;
  destAbs: string;
  templateText: string;
  templatePath: string;
}

interface PlannedWrite {
  filePath: string;
  text: string;
}

interface BaseWrite extends PlannedWrite {
  asset: string;
  sha256: string;
}

const parseYesFlag = (argv: readonly string[]): ParseYesResult => {
  if (argv.length === 0) {
    return { yes: false, help: false };
  }

  let yes = false;
  let help = false;

  for (const arg of argv) {
    if (arg === '-y' || arg === '--yes') {
      yes = true;

      continue;
    }

    if (arg === '-h' || arg === '--help') {
      help = true;

      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`[firebat] Unknown option: ${arg}`);
    }
  }

  return { yes, help };
};

const ensureGitignoreHasFirebat = async (rootAbs: string): Promise<boolean> => {
  if (rootAbs.trim().length === 0) {
    return false;
  }

  const gitignorePath = path.join(rootAbs, '.gitignore');
  const entry = '.firebat/';
  let updated = true;

  try {
    const current = await Bun.file(gitignorePath).text();

    if (current.split(/\r?\n/).some(line => line.trim() === entry)) {
      updated = false;
    } else {
      const next = current.endsWith('\n') ? `${current}${entry}\n` : `${current}\n${entry}\n`;

      await Bun.write(gitignorePath, next);
    }
  } catch {
    await Bun.write(gitignorePath, `${entry}\n`);
  }

  return updated;
};

const installTextFileNoOverwrite = async (destPath: string, desiredText: string): Promise<AssetInstallResult> => {
  const dest = Bun.file(destPath);
  const desiredSha256 = await sha256Hex(desiredText);
  let result: AssetInstallResult = { kind: 'installed', filePath: destPath, desiredSha256 };

  if (destPath.trim().length === 0) {
    return { kind: 'skipped-exists-different', filePath: destPath, desiredSha256, existingSha256: 'invalid-path' };
  }

  if (await dest.exists()) {
    try {
      const existingText = await dest.text();
      const existingSha256 = await sha256Hex(existingText);

      if (existingText === desiredText) {
        result = { kind: 'skipped-exists-same', filePath: destPath, desiredSha256, existingSha256 };
      }

      if (existingText !== desiredText) {
        result = { kind: 'skipped-exists-different', filePath: destPath, desiredSha256, existingSha256 };
      }
    } catch {
      result = { kind: 'skipped-exists-different', filePath: destPath, desiredSha256, existingSha256: 'unreadable' };
    }
  } else {
    await Bun.write(destPath, desiredText);
  }

  return result;
};

const ensureBaseSnapshot = async (input: EnsureBaseSnapshotInput): Promise<EnsureBaseSnapshotResult> => {
  const baseDir = path.join(input.firebatDir, 'install-bases');

  await mkdir(baseDir, { recursive: true });

  const parsed = parseJsoncOrThrow(`assets/${input.assetFileName}`, input.templateText);
  const normalizedText = jsonText(parsed);
  const sha256 = await sha256Hex(normalizedText);
  const filePath = path.join(baseDir, `${input.assetFileName}.${sha256}.json`);
  const f = Bun.file(filePath);

  if (!(await f.exists())) {
    await Bun.write(filePath, normalizedText);
  }

  return { sha256, filePath };
};

interface StdoutColumns {
  readonly columns?: number;
}

const isTty = (): boolean => {
  return Boolean(process.stdout?.isTTY);
};

const H = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  gray: '\x1b[90m',
  white: '\x1b[37m',
} as const;

const hc = (text: string, code: string, color: boolean): string => (color ? `${code}${text}${H.reset}` : text);

const writeStdout = (text: string): void => {
  process.stdout.write(text + '\n');
};

const printInstallHelp = (): void => {
  const c = isTty();
  const lines = [
    '',
    `  ${hc('\ud83d\udd25 firebat install', `${H.bold}${H.cyan}`, c)}`,
    '',
    `  ${hc('USAGE', `${H.bold}${H.yellow}`, c)}`,
    '',
    `    ${hc('$', H.dim, c)} firebat install ${hc('[options]', H.gray, c)}`,
    `    ${hc('$', H.dim, c)} firebat i ${hc('[options]', H.gray, c)}`,
    '',
    `  ${hc('DESCRIPTION', `${H.bold}${H.yellow}`, c)}`,
    '',
    `    Initializes firebat in the current project:`,
    `    ${hc('\u2022', H.dim, c)} Creates ${hc('.firebatrc.jsonc', H.green, c)}, ${hc('.oxlintrc.jsonc', H.green, c)}, ${hc('.oxfmtrc.jsonc', H.green, c)}`,
    `    ${hc('\u2022', H.dim, c)} Sets up ${hc('.firebat/', H.green, c)} directory with SQLite cache`,
    `    ${hc('\u2022', H.dim, c)} Adds ${hc('.firebat/', H.green, c)} to ${hc('.gitignore', H.green, c)}`,
    `    ${hc('\u2022', H.dim, c)} Never overwrites existing config files`,
    '',
    `  ${hc('OPTIONS', `${H.bold}${H.yellow}`, c)}`,
    '',
    `    ${hc('-y, --yes', `${H.bold}${H.green}`, c)}   Skip confirmation prompts`,
    `    ${hc('-h, --help', `${H.bold}${H.green}`, c)}  Show this help`,
    '',
  ];

  writeStdout(lines.join('\n'));
};

const printUpdateHelp = (): void => {
  const c = isTty();
  const lines = [
    '',
    `  ${hc('\ud83d\udd25 firebat update', `${H.bold}${H.cyan}`, c)}`,
    '',
    `  ${hc('USAGE', `${H.bold}${H.yellow}`, c)}`,
    '',
    `    ${hc('$', H.dim, c)} firebat update ${hc('[options]', H.gray, c)}`,
    `    ${hc('$', H.dim, c)} firebat u ${hc('[options]', H.gray, c)}`,
    '',
    `  ${hc('DESCRIPTION', `${H.bold}${H.yellow}`, c)}`,
    '',
    `    Syncs config files with the latest firebat templates:`,
    `    ${hc('\u2022', H.dim, c)} Adds new keys from updated templates`,
    `    ${hc('\u2022', H.dim, c)} Removes keys no longer in templates`,
    `    ${hc('\u2022', H.dim, c)} Preserves your customized values and comments`,
    `    ${hc('\u2022', H.dim, c)} Requires a prior ${hc('firebat install', H.white, c)}`,
    '',
    `  ${hc('OPTIONS', `${H.bold}${H.yellow}`, c)}`,
    '',
    `    ${hc('-y, --yes', `${H.bold}${H.green}`, c)}   Skip confirmation prompts`,
    `    ${hc('-h, --help', `${H.bold}${H.green}`, c)}  Show this help`,
    '',
  ];

  writeStdout(lines.join('\n'));
};

interface AssetSpec {
  readonly asset: string;
  readonly dest: string;
}

const ASSETS: ReadonlyArray<AssetSpec> = [
  { asset: '.oxlintrc.jsonc', dest: '.oxlintrc.jsonc' },
  { asset: '.oxfmtrc.jsonc', dest: '.oxfmtrc.jsonc' },
  { asset: '.firebatrc.jsonc', dest: '.firebatrc.jsonc' },
];
const AGENT_PROMPT_BLOCK = [
  '## firebat (MCP Code Quality Scanner)',
  '',
  'Firebat provides both a CLI and an MCP server for code quality analysis.',
  '',
  '### What to do (for your AI agent)',
  '- Ask the user about their project constraints (stack, CI, coding conventions, risk tolerance).',
  '- Propose a project-specific workflow that uses `scan` to prevent regressions and keep code style consistent.',
  '- When suggesting or making code changes, validate with `scan`.',
  '- Add the agreed workflow as project-specific agent rules so it stays consistent over time.',
  '',
  '### Tools (reference)',
  '- 🔍 Analysis: `scan`',
].join('\n');

const printAgentPromptGuide = (): void => {
  const c = isTty();
  const promptLines = AGENT_PROMPT_BLOCK.split('\n');

  const getBoxInnerWidth = (): number => {
    const stdout = process.stdout;

    if (stdout === undefined || stdout === null) {
      return 72;
    }

    const columns =
      typeof stdout === 'object' && stdout !== null && 'columns' in stdout ? (stdout as StdoutColumns).columns : undefined;

    if (typeof columns !== 'number' || !Number.isFinite(columns)) {
      return 72;
    }

    // Layout: "  " + "│ " + content + "" (we print the right border separately).
    // Keep it within a readable range even on very wide terminals.
    const available = columns - 2 /* leading indent */ - 2 /* left border + space */ - 2 /* space + right border */;

    return Math.max(48, Math.min(100, available));
  };

  const boxWidth = getBoxInnerWidth();
  const boxedPromptLines = promptLines.flatMap(line => {
    const out: string[] = [];
    let rest = line;

    while (rest.length > boxWidth) {
      const slice = rest.slice(0, boxWidth + 1);
      let cut = slice.lastIndexOf(' ');

      if (cut <= 0) {
        // No whitespace to break on.
        cut = boxWidth;
      }

      out.push(rest.slice(0, cut).trimEnd());

      rest = rest.slice(cut).trimStart();
    }

    out.push(rest);

    return out;
  });
  const guideLines = [
    '',
    `  ${hc('🤖 Agent Integration', `${H.bold}${H.cyan}`, c)}`,
    '',
    `  Share the block below with your AI agent`,
    `  so it can discover firebat capabilities and tailor a workflow for this project:`,
    '',
    `  ${hc('┌' + '─'.repeat(boxWidth + 2) + '┐', H.dim, c)}`,
    ...boxedPromptLines.map(line => {
      const padded = line.padEnd(boxWidth, ' ');

      return `  ${hc('│', H.dim, c)} ${padded} ${hc('│', H.dim, c)}`;
    }),
    `  ${hc('└' + '─'.repeat(boxWidth + 2) + '┘', H.dim, c)}`,
    '',
  ];

  writeStdout(guideLines.join('\n'));
};

const runInstallLike = async (mode: 'install' | 'update', argv: readonly string[], logger: FirebatLogger): Promise<number> => {
  if (mode !== 'install' && mode !== 'update') {
    logger.error('Unknown install mode', { mode });

    return 1;
  }

  try {
    const { yes, help } = parseYesFlag(argv);

    void yes;
    logger.debug('install: starting', { mode, args: argv.join(' ') });

    if (help) {
      if (mode === 'install') {
        printInstallHelp();
      } else {
        printUpdateHelp();
      }

      return 0;
    }

    const ctx = await resolveRuntimeContextFromCwd();
    const rootAbs = ctx.rootAbs;
    const firebatDir = path.join(rootAbs, '.firebat');

    logger.debug('install: root resolved', { mode, rootAbs });

    await mkdir(firebatDir, { recursive: true });

    const assetResults: AssetInstallResult[] = [];
    const assetManifest: Record<string, AssetTemplateMeta> = {};
    const baseSnapshots: Record<string, BaseSnapshot> = {};
    const loadedTemplates: LoadedTemplate[] = [];

    for (const item of ASSETS) {
      const loaded = await loadFirstExistingText(resolveAssetCandidates(item.asset));

      loadedTemplates.push({
        asset: item.asset,
        destAbs: path.join(rootAbs, item.dest),
        templateText: loaded.text,
        templatePath: loaded.filePath,
      });

      logger.trace('Template loaded', { asset: item.asset, filePath: loaded.filePath });
    }

    if (mode === 'update') {
      const manifestPath = path.join(firebatDir, 'install-manifest.json');
      const mf = Bun.file(manifestPath);

      if (!(await mf.exists())) {
        logger.error('update aborted: no install manifest found. Run `firebat install` first.');

        return 1;
      }

      let manifest: unknown;

      try {
        manifest = await mf.json();
      } catch {
        logger.error('update aborted: install manifest is unreadable. Run `firebat install` first.');

        return 1;
      }

      const manifestObject = isPlainObject(manifest) ? (manifest as Record<string, unknown>) : null;
      const bases = manifestObject?.baseSnapshots;

      if (!isPlainObject(bases)) {
        logger.error('update aborted: no base snapshots found. Run `firebat install` first.');

        return 1;
      }

      // Compute all merged results first (rollback policy).
      const plannedWrites: PlannedWrite[] = [];
      const nextBaseWrites: BaseWrite[] = [];

      for (const tpl of loadedTemplates) {
        const baseMeta = (bases as Record<string, unknown>)[tpl.asset] as BaseSnapshot | undefined;
        const basePath = typeof baseMeta?.filePath === 'string' ? baseMeta.filePath : null;

        if (!basePath) {
          logger.error('update aborted: missing base snapshot. Run `firebat install` first.', { asset: tpl.asset });

          return 1;
        }

        const baseFile = Bun.file(basePath);

        if (!(await baseFile.exists())) {
          logger.error('update aborted: base snapshot not found. Run `firebat install` first.', { asset: tpl.asset });

          return 1;
        }

        const nextParsed = parseJsoncOrThrow(`assets/${tpl.asset}`, tpl.templateText);
        const destFile = Bun.file(tpl.destAbs);
        const userText = (await destFile.exists()) ? await destFile.text() : null;

        if (userText === null) {
          plannedWrites.push({ filePath: tpl.destAbs, text: tpl.templateText });
        } else {
          // Validate current file first.
          void parseJsoncOrThrow(tpl.destAbs, userText);

          const synced = syncJsoncTextToTemplateKeys({ userText, templateJson: nextParsed });

          if (!synced.ok) {
            logger.error('update aborted: failed to patch JSONC', { filePath: tpl.destAbs, error: synced.error });

            return 1;
          }

          // Validate patched result.
          void parseJsoncOrThrow(tpl.destAbs, synced.text);

          if (synced.changed) {
            plannedWrites.push({ filePath: tpl.destAbs, text: synced.text });
          }
        }

        const nextNormalized = jsonText(nextParsed);
        const nextSha = await sha256Hex(nextNormalized);
        const nextBasePath = path.join(firebatDir, 'install-bases', `${tpl.asset}.${nextSha}.json`);

        nextBaseWrites.push({ filePath: nextBasePath, text: nextNormalized, asset: tpl.asset, sha256: nextSha });
      }

      // Apply writes.
      for (const w of plannedWrites) {
        await writeFileAtomic(w.filePath, w.text);
        assetResults.push({ kind: 'installed', filePath: w.filePath, desiredSha256: await sha256Hex(w.text) });
      }

      await mkdir(path.join(firebatDir, 'install-bases'), { recursive: true });

      for (const b of nextBaseWrites) {
        const f = Bun.file(b.filePath);

        if (!(await f.exists())) {
          await Bun.write(b.filePath, b.text);
        }

        baseSnapshots[b.asset] = { sha256: b.sha256, filePath: b.filePath };
      }

      for (const tpl of loadedTemplates) {
        const nextParsed = parseJsoncOrThrow(`assets/${tpl.asset}`, tpl.templateText);
        const nextNormalized = jsonText(nextParsed);

        assetManifest[tpl.asset] = { sourcePath: tpl.templatePath, sha256: await sha256Hex(nextNormalized) };
      }
    } else {
      for (const tpl of loadedTemplates) {
        const base = await ensureBaseSnapshot({ rootAbs, firebatDir, assetFileName: tpl.asset, templateText: tpl.templateText });

        baseSnapshots[tpl.asset] = base;

        const desiredParsed = parseJsoncOrThrow(`assets/${tpl.asset}`, tpl.templateText);
        const desiredNormalized = jsonText(desiredParsed);
        const desiredInstalled = tpl.templateText;

        assetManifest[tpl.asset] = { sourcePath: tpl.templatePath, sha256: await sha256Hex(desiredNormalized) };

        assetResults.push(await installTextFileNoOverwrite(tpl.destAbs, desiredInstalled));
      }
    }

    const gitignoreUpdated = await ensureGitignoreHasFirebat(rootAbs);

    // DB warm-up (creates .firebat/firebat.sqlite + runs migrations)
    await getOrmDb({ rootAbs, logger });

    const installManifestPath = path.join(firebatDir, 'install-manifest.json');
    const manifestOut = {
      installedAt: new Date().toISOString(),
      rootAbs,
      assetTemplates: assetManifest,
      baseSnapshots,
      results: assetResults,
      gitignoreUpdated,
    };

    await Bun.write(installManifestPath, JSON.stringify(manifestOut, null, 2) + '\n');

    logger.info('install: complete', { mode, rootAbs });
    logger.debug('install: created/verified directory', { firebatDir });

    if (gitignoreUpdated) {
      logger.info('updated .gitignore: added .firebat/');
    }

    if (mode === 'install') {
      const diffs = assetResults.filter(r => r.kind === 'skipped-exists-different');

      for (const r of assetResults) {
        if (r.kind === 'installed') {
          logger.info('installed', { filePath: r.filePath });
        } else if (r.kind === 'skipped-exists-same') {
          logger.debug('kept existing (same)', { filePath: r.filePath });
        } else {
          logger.warn('kept existing (DIFFERENT)', { filePath: r.filePath });
        }
      }
      if (diffs.length > 0) {
        logger.warn('Some files differ from the current templates. Per policy, install never overwrites.');
        logger.info('See install manifest for template hashes and paths', { installManifestPath });
      }
    } else {
      if (assetResults.length === 0) {
        logger.info('update: no changes');
      } else {
        for (const r of assetResults) {
          logger.info('updated', { filePath: r.filePath });
        }
      }
    }

    if (mode === 'install') {
      printAgentPromptGuide();
    }

    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    logger.error(message, undefined, err);

    return 1;
  }
};

export const runInstall = async (argv: readonly string[] | undefined, logger: FirebatLogger): Promise<number> => {
  const safeArgv = argv ?? [];

  return runInstallLike('install', safeArgv, logger);
};

export const runUpdate = async (argv: readonly string[] | undefined, logger: FirebatLogger): Promise<number> => {
  const safeArgv = argv ?? [];

  return runInstallLike('update', safeArgv, logger);
};

export const __testing__ = {
  sha256Hex,
  isPlainObject,
  toJsonValue,
  sortJsonValue,
  jsonText,
  parseYesFlag,
};
