import { normalizePath } from '@zipbul/gildash';

const isTestLikePath = (value: string): boolean => {
  const normalized = normalizePath(value);

  return (
    normalized.includes('/test/') ||
    normalized.includes('/tests/') ||
    normalized.endsWith('.test.ts') ||
    normalized.endsWith('.spec.ts')
  );
};

export { isTestLikePath };
