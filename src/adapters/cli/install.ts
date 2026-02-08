import * as path from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';

import { resolveRuntimeContextFromCwd } from '../../runtime-context';
import { getOrmDb } from '../../infrastructure/sqlite/firebat.db';
import type { FirebatLogger } from '../../ports/logger';

import { syncJsoncTextToTemplateKeys } from './firebatrc-jsonc-sync';

import { loadFirstExistingText, resolveAssetCandidates } from './install-assets';

type JsonValue = null | boolean | number | string | JsonValue[] | { readonly [key: string]: JsonValue };

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

const toJsonValue = (value: unknown): JsonValue => {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;

  if (Array.isArray(value)) {
    return value.map(item => toJsonValue(item));
  }

  if (isPlainObject(value)) {
    const out: Record<string, JsonValue> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = toJsonValue(v);
    }
    return out;
  }

  throw new Error('[firebat] Invalid JSON value (non-JSON type encountered)');
};

const deepEqual = (a: JsonValue, b: JsonValue): boolean => {
  if (a === b) return true;

  if (a === null || b === null) return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqual(a[i]!, b[i]!)) return false;
    }
    return true;
  }

  if (typeof a === 'object') {
    if (typeof b !== 'object' || Array.isArray(b)) return false;
    const aKeys = Object.keys(a as any).sort();
    const bKeys = Object.keys(b as any).sort();
    if (aKeys.length !== bKeys.length) return false;
    for (let i = 0; i < aKeys.length; i += 1) {
      if (aKeys[i] !== bKeys[i]) return false;
    }
    for (const k of aKeys) {
      const av = (a as any)[k] as JsonValue;
      const bv = (b as any)[k] as JsonValue;
      if (!deepEqual(av, bv)) return false;
    }
    return true;
  }

  return false;
};

const sortJsonValue = (value: JsonValue): JsonValue => {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(v => sortJsonValue(v));

  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  const out: Record<string, JsonValue> = {};
  for (const [k, v] of entries) {
    out[k] = sortJsonValue(v);
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
  try {
    return toJsonValue(Bun.JSONC.parse(text));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[firebat] Failed to parse JSONC: ${filePath}: ${msg}`);
  }
};

const parseYesFlag = (argv: readonly string[]): { yes: boolean; help: boolean } => {
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
  const gitignorePath = path.join(rootAbs, '.gitignore');
  const entry = '.firebat/';

  try {
    const current = await readFile(gitignorePath, 'utf8');

    if (current.split(/\r?\n/).some(line => line.trim() === entry)) {
      return false;
    }

    const next = current.endsWith('\n') ? `${current}${entry}\n` : `${current}\n${entry}\n`;

    await writeFile(gitignorePath, next, 'utf8');

    return true;
  } catch {
    await writeFile(gitignorePath, `${entry}\n`, 'utf8');

    return true;
  }
};

const installTextFileNoOverwrite = async (destPath: string, desiredText: string): Promise<AssetInstallResult> => {
  const dest = Bun.file(destPath);
  const desiredSha256 = await sha256Hex(desiredText);

  if (await dest.exists()) {
    try {
      const existingText = await dest.text();
      const existingSha256 = await sha256Hex(existingText);

      if (existingText === desiredText) {
        return { kind: 'skipped-exists-same', filePath: destPath, desiredSha256, existingSha256 };
      }

      return { kind: 'skipped-exists-different', filePath: destPath, desiredSha256, existingSha256 };
    } catch {
      return { kind: 'skipped-exists-different', filePath: destPath, desiredSha256, existingSha256: 'unreadable' };
    }
  }

  await Bun.write(destPath, desiredText);

  return { kind: 'installed', filePath: destPath, desiredSha256 };
};

const ensureBaseSnapshot = async (input: {
  readonly rootAbs: string;
  readonly firebatDir: string;
  readonly assetFileName: string;
  readonly templateText: string;
}): Promise<{ sha256: string; filePath: string }> => {
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

const isTty = (): boolean => Boolean((process as any)?.stdout?.isTTY);

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

const hc = (text: string, code: string, color: boolean): string => color ? `${code}${text}${H.reset}` : text;

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

type AssetSpec = Readonly<{ asset: string; dest: string }>;

const ASSETS: ReadonlyArray<AssetSpec> = [
  { asset: '.oxlintrc.jsonc', dest: '.oxlintrc.jsonc' },
  { asset: '.oxfmtrc.jsonc', dest: '.oxfmtrc.jsonc' },
  { asset: '.firebatrc.jsonc', dest: '.firebatrc.jsonc' },
];

const AGENT_PROMPT_BLOCK = [
  '## firebat (MCP Code Quality Scanner)',
  '',
  'This project uses a firebat MCP server for automated code quality analysis.',
  '',
  '### Tool Categories',
  '- 🔍 Analysis: `scan` (15 detectors), `lint` (oxlint), `find_pattern` (ast-grep structural search)',
  '- 🧭 Navigation: `get_hover`, `get_definitions`, `find_references`, `trace_symbol`, `parse_imports`, `get_document_symbols`, `get_workspace_symbols`, `get_signature_help`',
  '- ✏️ Editing: `replace_range`, `replace_regex`, `replace_symbol_body`, `insert_before_symbol`, `insert_after_symbol`, `rename_symbol`, `delete_symbol`, `format_document`, `get_code_actions`',
  '- 📇 Indexing: `index_symbols`, `search_symbol_from_index`, `clear_index`, `get_project_overview`',
  '- 📦 External libs: `index_external_libraries`, `search_external_library_symbols`, `get_available_external_symbols`, `get_typescript_dependencies`',
  '- 🧠 Memory: `read_memory`, `write_memory`, `list_memories`, `delete_memory`',
  '- 🛠️ Infra: `list_dir`, `get_diagnostics`, `get_all_diagnostics`, `get_completion`, `check_capabilities`',
  '',
  '### Required Rules',
  '- After any code change, always run `scan` to check for quality regressions.',
  '- Review scan findings and address them in priority order before moving on.',
  '',
  '### When to Use What',
  '- After editing code → `scan`',
  '- Finding a symbol → `index_symbols` → `search_symbol_from_index`',
  '- Refactoring → `find_references` → `rename_symbol`',
  '- Searching code patterns → `find_pattern` (ast-grep syntax)',
  '- Checking types / signatures → `get_hover`',
  '- Exploring external library APIs → `index_external_libraries` → `search_external_library_symbols`',
  '- Reviewing analysis results → invoke the `workflow` or `review` prompt',
].join('\n');

const printAgentPromptGuide = (): void => {
  const c = isTty();
  const border = '│';
  const promptLines = AGENT_PROMPT_BLOCK.split('\n');

  const guideLines = [
    '',
    `  ${hc('🤖 Agent Integration', `${H.bold}${H.cyan}`, c)}`,
    '',
    `  Copy the block below into your agent\'s instruction file`,
    `  ${hc('(e.g. copilot-instructions.md, AGENTS.md, .cursor/rules)', H.dim, c)}`,
    `  so your AI agent can leverage firebat automatically:`,
    '',
    `  ${hc('┌' + '─'.repeat(72), H.dim, c)}`,
    ...promptLines.map(line => `  ${hc(border, H.dim, c)} ${line}`),
    `  ${hc('└' + '─'.repeat(72), H.dim, c)}`,
    '',
  ];

  writeStdout(guideLines.join('\n'));
};

const runInstallLike = async (mode: 'install' | 'update', argv: readonly string[], logger: FirebatLogger): Promise<number> => {
  try {
    const { yes, help } = parseYesFlag(argv);
    void yes;
    logger.debug(`${mode}: starting`, { args: argv.join(' ') });

    if (help) {
      if (mode === 'install') printInstallHelp();
      else printUpdateHelp();
      return 0;
    }

    const ctx = await resolveRuntimeContextFromCwd();
    const rootAbs = ctx.rootAbs;
    const firebatDir = path.join(rootAbs, '.firebat');
    logger.debug(`${mode} root: ${rootAbs}`);

    await mkdir(firebatDir, { recursive: true });

    const assetResults: AssetInstallResult[] = [];
    const assetManifest: Record<string, AssetTemplateMeta> = {};
    const baseSnapshots: Record<string, { sha256: string; filePath: string }> = {};

    const loadedTemplates: Array<{ asset: string; destAbs: string; templateText: string; templatePath: string }> = [];

    for (const item of ASSETS) {
      const loaded = await loadFirstExistingText(resolveAssetCandidates(item.asset));
      loadedTemplates.push({
        asset: item.asset,
        destAbs: path.join(rootAbs, item.dest),
        templateText: loaded.text,
        templatePath: loaded.filePath,
      });
      logger.trace(`Template loaded: ${item.asset} from ${loaded.filePath}`);
    }

    if (mode === 'update') {
      const manifestPath = path.join(firebatDir, 'install-manifest.json');
      const mf = Bun.file(manifestPath);
      if (!(await mf.exists())) {
        logger.error('update aborted: no install manifest found. Run `firebat install` first.');
        return 1;
      }

      let manifest: any;
      try {
        manifest = await mf.json();
      } catch {
        logger.error('update aborted: install manifest is unreadable. Run `firebat install` first.');
        return 1;
      }

      const bases = manifest?.baseSnapshots;
      if (!bases || typeof bases !== 'object') {
        logger.error('update aborted: no base snapshots found. Run `firebat install` first.');
        return 1;
      }

      // Compute all merged results first (rollback policy).
      const plannedWrites: Array<{ filePath: string; text: string }> = [];
      const nextBaseWrites: Array<{ filePath: string; text: string; asset: string; sha256: string }> = [];

      for (const tpl of loadedTemplates) {
        const baseMeta = (bases as any)[tpl.asset];
        const basePath = typeof baseMeta?.filePath === 'string' ? baseMeta.filePath : null;

        if (!basePath) {
          logger.error(`update aborted: missing base snapshot for ${tpl.asset}. Run \`firebat install\` first.`);
          return 1;
        }

        const baseFile = Bun.file(basePath);
        if (!(await baseFile.exists())) {
          logger.error(`update aborted: base snapshot not found for ${tpl.asset}. Run \`firebat install\` first.`);
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
            logger.error(`update aborted: failed to patch JSONC for ${tpl.destAbs}: ${synced.error}`);
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

    logger.info(`${mode} root: ${rootAbs}`);
    logger.debug(`created/verified: ${firebatDir}`);

    if (gitignoreUpdated) {
      logger.info('updated .gitignore: added .firebat/');
    }

    if (mode === 'install') {
      const diffs = assetResults.filter(r => r.kind === 'skipped-exists-different');
      for (const r of assetResults) {
        if (r.kind === 'installed') { logger.info(`installed ${r.filePath}`); }
        else if (r.kind === 'skipped-exists-same') { logger.debug(`kept existing (same) ${r.filePath}`); }
        else { logger.warn(`kept existing (DIFFERENT) ${r.filePath}`); }
      }
      if (diffs.length > 0) {
        logger.warn('Some files differ from the current templates. Per policy, install never overwrites.');
        logger.info(`See ${installManifestPath} for template hashes and paths.`);
      }
    } else {
      if (assetResults.length === 0) {
        logger.info('update: no changes');
      } else {
        for (const r of assetResults) {
          logger.info(`updated ${r.filePath}`);
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

export const runInstall = async (argv: readonly string[] = [], logger: FirebatLogger): Promise<number> => {
  return runInstallLike('install', argv, logger);
};

export const runUpdate = async (argv: readonly string[] = [], logger: FirebatLogger): Promise<number> => {
  return runInstallLike('update', argv, logger);
};
