import * as path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { resolveRuntimeContextFromCwd } from '../../runtime-context';
import { getOrmDb } from '../../infrastructure/sqlite/firebat.db';

interface LoadedTextFile {
  readonly filePath: string;
  readonly text: string;
}

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

const loadFirstExistingText = async (candidates: ReadonlyArray<string>): Promise<LoadedTextFile> => {
  for (const filePath of candidates) {
    try {
      const file = Bun.file(filePath);

      if (!(await file.exists())) {
        continue;
      }

      return { filePath, text: await file.text() };
    } catch {
      continue;
    }
  }

  throw new Error('[firebat] Could not locate packaged assets/. Ensure the firebat package includes assets/.');
};

const resolveAssetCandidates = (assetFileName: string): string[] => {
  // Works in both repo (src/* sibling to assets/*) and published package (dist/* sibling to assets/*)
  return [
    path.resolve(import.meta.dir, '../../../assets', assetFileName),
    path.resolve(import.meta.dir, '../../assets', assetFileName),
    path.resolve(import.meta.dir, '../assets', assetFileName),
    path.resolve(process.cwd(), 'assets', assetFileName),
  ];
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

export const runInstall = async (): Promise<void> => {
  const ctx = await resolveRuntimeContextFromCwd();
  const rootAbs = ctx.rootAbs;
  const firebatDir = path.join(rootAbs, '.firebat');

  await mkdir(firebatDir, { recursive: true });

  const assets = [
    { asset: '.oxlintrc.jsonc', dest: path.join(rootAbs, '.oxlintrc.jsonc') },
    { asset: '.oxfmtrc.jsonc', dest: path.join(rootAbs, '.oxfmtrc.jsonc') },
  ] as const;
  const assetResults: AssetInstallResult[] = [];
  const assetManifest: Record<string, AssetTemplateMeta> = {};

  for (const item of assets) {
    const loaded = await loadFirstExistingText(resolveAssetCandidates(item.asset));
    const desired = loaded.text;

    assetManifest[item.asset] = { sourcePath: loaded.filePath, sha256: await sha256Hex(desired) };

    assetResults.push(await installTextFileNoOverwrite(item.dest, desired));
  }

  const gitignoreUpdated = await ensureGitignoreHasFirebat(rootAbs);

  // DB warm-up (creates .firebat/firebat.sqlite + runs migrations)
  await getOrmDb({ rootAbs });

  const installManifestPath = path.join(firebatDir, 'install-manifest.json');
  const manifest = {
    installedAt: new Date().toISOString(),
    rootAbs,
    assetTemplates: assetManifest,
    results: assetResults,
    gitignoreUpdated,
  };

  await Bun.write(installManifestPath, JSON.stringify(manifest, null, 2) + '\n');

  const diffs = assetResults.filter(r => r.kind === 'skipped-exists-different');

  console.log(`[firebat] install root: ${rootAbs}`);
  console.log(`[firebat] created/verified: ${firebatDir}`);

  if (gitignoreUpdated) {
    console.log('[firebat] updated .gitignore: added .firebat/');
  }

  for (const r of assetResults) {
    if (r.kind === 'installed') {
      console.log(`[firebat] installed ${r.filePath}`);
    } else if (r.kind === 'skipped-exists-same') {
      console.log(`[firebat] kept existing (same) ${r.filePath}`);
    } else {
      console.log(`[firebat] kept existing (DIFFERENT) ${r.filePath}`);
    }
  }

  if (diffs.length > 0) {
    console.log('[firebat] NOTE: Some files differ from the current templates. Per policy, install never overwrites.');
    console.log(`[firebat] See ${installManifestPath} for template hashes and paths.`);
  }

  console.log('');
  console.log('[firebat] MCP SSOT: If you register this project context in your MCP SSOT, agents can use it more proactively.');
};
