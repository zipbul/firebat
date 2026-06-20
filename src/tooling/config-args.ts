/**
 * Builds the leading `--config <path>` CLI arguments shared by the oxc tool
 * runners (oxfmt, oxlint). A single change point for the config-path convention
 * (flag name + "non-blank path" guard); each runner appends its own flags after.
 */
export const configArgs = (configPath?: string): string[] =>
  configPath !== undefined && configPath.trim().length > 0 ? ['--config', configPath] : [];
