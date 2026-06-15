import type { RuleContext } from '../types';

function getContextFilename(context: RuleContext): string | null {
  if (typeof context.getFilename === 'function') {
    const filename = context.getFilename();

    if (typeof filename === 'string' && filename.length > 0) {
      return filename;
    }
  }

  if (typeof context.filename === 'string' && context.filename.length > 0) {
    return context.filename;
  }

  return null;
}

export { getContextFilename };
