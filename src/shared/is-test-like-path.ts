import { normalizePath } from '@zipbul/gildash';

const isTestLikePath = (value: string): boolean => {
  const normalized = normalizePath(value);

  return (
    normalized.includes('/test/') ||
    normalized.includes('/tests/') ||
    normalized.includes('/__tests__/') ||
    normalized.endsWith('.test.ts') ||
    normalized.endsWith('.spec.ts')
  );
};

const CONFIG_PATTERNS = ['.config.ts', '.config.js', '.config.cjs', '.config.mjs', 'rc.ts', 'rc.js', 'rc.cjs'];

const isConfigLikePath = (value: string): boolean => {
  const normalized = normalizePath(value);
  const basename = normalized.split('/').pop() ?? '';

  return CONFIG_PATTERNS.some(p => basename.endsWith(p)) || normalized.includes('/scripts/') || normalized.includes('/bin/');
};

export { isConfigLikePath, isTestLikePath };
