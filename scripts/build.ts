const runBuild = async (): Promise<void> => {
  const outdir = 'dist';
  const logPrefix = '🔥 firebat:build';

  console.info(`${logPrefix} start`);

  const cliNaming = 'firebat.js';
  const cliDistFilePath = `${outdir}/${cliNaming}`;
  const cliBuildResult = await Bun.build({
    entrypoints: ['index.ts'],
    outdir,
    target: 'bun',
    minify: true,
    sourcemap: 'inline',
    packages: 'external',
    naming: cliNaming,
  });
  const pluginBuildResult = await Bun.build({
    entrypoints: ['oxlint-plugin.ts'],
    outdir,
    target: 'bun',
    minify: true,
    sourcemap: 'inline',
    packages: 'external',
    naming: 'oxlint-plugin.js',
  });

  if (!cliBuildResult.success || !pluginBuildResult.success) {
    console.error(`${logPrefix} failed`);
    console.error([...cliBuildResult.logs, ...pluginBuildResult.logs]);

    process.exit(1);
  }

  let content = await Bun.file(cliDistFilePath).text();

  if (!content.startsWith('#!')) {
    content = `#!/usr/bin/env bun\n${content}`;

    await Bun.write(cliDistFilePath, content);
  }

  const chmodResult = Bun.spawnSync(['chmod', '755', cliDistFilePath]);

  if (chmodResult.exitCode !== 0) {
    console.error(`${logPrefix} chmod failed (${chmodResult.exitCode})`);

    process.exit(1);
  }

  // NOTE: Drizzle migrator expects migrationsFolder/meta/_journal.json at runtime.
  // We ship migrations as packaged, read-only assets next to dist/*.js.
  try {
    const migrationsSrcDirPath = 'src/infrastructure/sqlite/migrations';
    const migrationsDistDirPath = `${outdir}/migrations`;

    await Bun.$`rm -rf ${migrationsDistDirPath}`;
    await Bun.$`mkdir -p ${migrationsDistDirPath}`;
    await Bun.$`cp -R ${migrationsSrcDirPath}/. ${migrationsDistDirPath}/`;
  } catch (error) {
    console.error(`${logPrefix} failed: could not copy migrations into dist/`);
    console.error(error);

    process.exit(1);
  }

  console.info(`${logPrefix} done`);
};

void runBuild();
