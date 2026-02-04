export const computeToolVersion = (): string => {
  const baseToolVersion = '2.0.0-strict';
  const defaultCacheVersion = '2026-02-02-tsgo-lsp-v1';

  return `${baseToolVersion}+${defaultCacheVersion}`;
};
