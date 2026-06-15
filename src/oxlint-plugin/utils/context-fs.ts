import type { RuleContext } from '../types';

function fileExists(context: RuleContext, filePath: string): boolean | null {
  if (typeof context.fileExists === 'function') {
    return context.fileExists(filePath);
  }

  return null;
}

export { fileExists };
