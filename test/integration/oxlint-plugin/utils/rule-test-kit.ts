import type {
  AstRoot,
  AstNode,
  Fix,
  Fixer,
  Range,
  ReportDescriptor,
  RuleContext,
  Scope,
  SourceCode,
  SourceToken,
  Variable,
} from '../../../../src/test-api';

interface RuleContextExtras {
  filename?: string;
  fileExists?: (filePath: string) => boolean;
  readFile?: (filePath: string) => string | null;
}

function createSourceCode(text: string, ast: AstRoot | null, scope: Scope | null, tokens: SourceToken[]) {
  const getNodeRange = (node: AstNode): Range | null => {
    const range = node?.range;

    if (!Array.isArray(range) || range.length !== 2) {
      return null;
    }

    const [start, end] = range;

    if (typeof start !== 'number' || typeof end !== 'number') {
      return null;
    }

    return [start, end];
  };

  const getTokenBefore = (node: AstNode): SourceToken | null => {
    const nodeRange = getNodeRange(node);

    if (!nodeRange || !Array.isArray(tokens) || tokens.length === 0) {
      return null;
    }

    const nodeStart = nodeRange[0];
    let best: SourceToken | null = null;

    for (const token of tokens) {
      const range = token?.range;

      if (!Array.isArray(range) || range.length !== 2) {
        continue;
      }

      const end = range[1];

      if (typeof end !== 'number') {
        continue;
      }

      if (end <= nodeStart) {
        if (!best || (Array.isArray(best.range) && typeof best.range[1] === 'number' && best.range[1] < end)) {
          best = token;
        }
      }
    }

    return best;
  };

  const getTokenAfter = (node: AstNode): SourceToken | null => {
    const nodeRange = getNodeRange(node);

    if (!nodeRange || !Array.isArray(tokens) || tokens.length === 0) {
      return null;
    }

    const nodeEnd = nodeRange[1];
    let best: SourceToken | null = null;

    for (const token of tokens) {
      const range = token?.range;

      if (!Array.isArray(range) || range.length !== 2) {
        continue;
      }

      const start = range[0];

      if (typeof start !== 'number') {
        continue;
      }

      if (start >= nodeEnd) {
        if (!best || (Array.isArray(best.range) && typeof best.range[0] === 'number' && start < best.range[0])) {
          best = token;
        }
      }
    }

    return best;
  };

  const sourceCode: SourceCode = {
    text,
    ast,
    scope,
    tokens,
    getText: () => text,
    getLines: () => text.split('\n'),
    getTokenBefore,
    getTokenAfter,
    getAllComments: () => (Array.isArray(ast?.comments) ? ast.comments : []),
  };

  return sourceCode;
}

const createFixer = (): Fixer => {
  return {
    replaceTextRange(range: Range, replacement: string): Fix {
      return { range, text: replacement };
    },
    removeRange(range: Range): Fix {
      return { range, text: '' };
    },
    remove(node: AstNode): Fix {
      const range = node.range;

      if (!Array.isArray(range) || range.length !== 2) {
        return { range: [0, 0], text: '' };
      }

      return { range: [range[0], range[1]], text: '' };
    },
  };
};

function applyFixes(text: string, reports: ReportDescriptor[]): string {
  const fixer = createFixer();
  const fixes: Fix[] = [];

  for (const report of reports) {
    if (typeof report.fix !== 'function') {
      continue;
    }

    const fix = report.fix(fixer);

    if (fix && Array.isArray(fix.range) && fix.range.length === 2) {
      fixes.push(fix);
    }
  }

  if (fixes.length === 0) {
    return text;
  }

  // Apply from right-to-left to keep ranges stable.
  const sorted = [...fixes].sort((a, b) => b.range[0] - a.range[0]);

  // Ensure no overlaps (overlapping autofixes are a bug).
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const current = sorted[i];
    const next = sorted[i + 1];

    if (current !== undefined && next !== undefined && next.range[1] > current.range[0]) {
      throw new Error('Overlapping fixes are not supported');
    }
  }

  let out = text;

  for (const fix of sorted) {
    const [start, end] = fix.range;
    const replacement = typeof fix.text === 'string' ? fix.text : '';

    out = out.slice(0, start) + replacement + out.slice(end);
  }

  return out;
}

// We don't export local ReportDescriptor anymore, use the one from types

function createRuleContext(
  sourceCode: ReturnType<typeof createSourceCode>,
  options: RuleContext['options'] = [],
  getDeclaredVariables?: (node: AstNode) => Variable[],
  extras?: RuleContextExtras,
) {
  const reports: ReportDescriptor[] = [];
  const context: RuleContext = {
    options,
    getSourceCode: () => sourceCode,
    report: (descriptor: ReportDescriptor) => {
      reports.push(descriptor);
    },
  };

  if (getDeclaredVariables) {
    context.getDeclaredVariables = getDeclaredVariables;
  }

  if (typeof extras?.filename === 'string' && extras.filename.length > 0) {
    context.filename = extras.filename;
  }

  if (extras?.fileExists) {
    context.fileExists = extras.fileExists;
  }

  if (extras?.readFile) {
    context.readFile = extras.readFile;
  }

  return { context, reports };
}

export type { ReportDescriptor, RuleContext, RuleContextExtras, SourceCode };
export { applyFixes, createRuleContext, createSourceCode };
