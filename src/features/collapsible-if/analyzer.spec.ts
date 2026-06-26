import { describe, expect, it } from 'bun:test';

import { type SourceCase, analyzeSource, expectNoFindings, parseProgram as parse } from '../../../test/integration/shared/test-kit';
import { analyzeCollapsibleIf } from './analyzer';

/** Assert exactly one finding whose `kind` is `kind`. */
const expectKind = (result: ReadonlyArray<{ readonly kind: string }>, kind: string): void => {
  expect(result).toHaveLength(1);
  expect(result[0]!.kind).toBe(kind);
};

type NoFindingCase = SourceCase;

interface CollapsibleIfCase {
  name: string;
  source: string;
  score: number;
  depthReduction: number;
  statementsAffected: number;
}

interface ElseIfCase {
  name: string;
  source: string;
  statementsAffected: number;
  score: number;
}

const noFindingCases: NoFindingCase[] = [
  {
    name: 'outer has else',
    source: `
export function f(a: boolean, b: boolean) {
  if (a) {
    if (b) {
      doA();
      doB();
      doC();
    }
  } else {
    doElse();
  }
}
`,
  },
  {
    name: 'inner has else',
    source: `
export function f(a: boolean, b: boolean) {
  if (a) {
    if (b) {
      doA();
      doB();
      doC();
    } else {
      doElse();
    }
  }
}
`,
  },
  {
    name: 'outer body has 2+ stmts',
    source: `
export function f(a: boolean, b: boolean) {
  if (a) {
    doSetup();
    if (b) {
      doA();
      doB();
      doC();
    }
  }
}
`,
  },
  {
    name: 'inner consequent has 2 stmts (below MIN_INNER_STMTS=3)',
    source: `
export function f(a: boolean, b: boolean) {
  if (a) {
    if (b) {
      doA();
      doB();
    }
  }
}
`,
  },
  {
    name: 'inner consequent is single expression (no block)',
    source: `
export function f(a: boolean, b: boolean) {
  if (a) {
    if (b) doA();
  }
}
`,
  },
  {
    name: 'else block with 2+ stmts',
    source: `
export function f(a: boolean, b: boolean) {
  if (a) {
    doA();
  } else {
    doSetup();
    if (b) {
      doB();
    }
  }
}
`,
  },
  {
    name: 'already else-if: if(a){} else if(b){}',
    source: `
export function f(a: boolean, b: boolean) {
  if (a) {
    doA();
  } else if (b) {
    doB();
    doC();
    doD();
  }
}
`,
  },
  {
    name: 'empty else block: else {}',
    source: `
export function f(a: boolean) {
  if (a) {
    doA();
  } else {
  }
}
`,
  },
  {
    name: 'empty inner if consequent: else { if(b) {} }',
    source: `
export function f(a: boolean, b: boolean) {
  if (a) {
    doA();
  } else {
    if (b) {}
  }
}
`,
  },
  {
    name: 'else block with non-if stmt',
    source: `
export function f(a: boolean) {
  if (a) {
    doA();
  } else {
    doB();
  }
}
`,
  },
];
const collapsibleIfCases: CollapsibleIfCase[] = [
  {
    name: 'basic: if(a) { if(b) { 3 stmts } }',
    source: `
export function f(a: boolean, b: boolean) {
  if (a) {
    if (b) {
      doA();
      doB();
      doC();
    }
  }
}
`,
    score: 3,
    depthReduction: 1,
    statementsAffected: 3,
  },
  {
    name: 'score scales with inner count (5 stmts)',
    source: `
export function f(a: boolean, b: boolean) {
  if (a) {
    if (b) {
      doA();
      doB();
      doC();
      doD();
      doE();
    }
  }
}
`,
    score: 5,
    depthReduction: 1,
    statementsAffected: 5,
  },
  {
    name: '3-level nesting: detects if(b)+if(c) pair',
    source: `
export function f(a: boolean, b: boolean, c: boolean) {
  if (a) {
    if (b) {
      if (c) {
        doA();
        doB();
        doC();
      }
    }
  }
}
`,
    score: 3,
    depthReduction: 1,
    statementsAffected: 3,
  },
  {
    name: 'class method',
    source: `
export class Handler {
  handle(a: boolean, b: boolean) {
    if (a) {
      if (b) {
        doA();
        doB();
        doC();
      }
    }
  }
}
`,
    score: 3,
    depthReduction: 1,
    statementsAffected: 3,
  },
  {
    name: 'inside loop',
    source: `
export function f(items: Array<{ a: boolean; b: boolean }>) {
  for (const item of items) {
    if (item.a) {
      if (item.b) {
        doA(item);
        doB(item);
        doC(item);
      }
    }
  }
}
`,
    score: 3,
    depthReduction: 1,
    statementsAffected: 3,
  },
  {
    name: 'nested function boundary - isolated to inner function',
    source: `
export function outer() {
  const inner = (a: boolean, b: boolean) => {
    if (a) {
      if (b) {
        doA();
        doB();
        doC();
      }
    }
  };
  return inner;
}
`,
    score: 3,
    depthReduction: 1,
    statementsAffected: 3,
  },
];
const elseIfCases: ElseIfCase[] = [
  {
    name: 'else { if(b) { ... } }',
    source: `
export function f(a: boolean, b: boolean) {
  if (a) {
    doA();
  } else {
    if (b) {
      doB();
    }
  }
}
`,
    statementsAffected: 3, // max(1, MIN_INNER_STMTS=3)
    score: 3,
  },
  {
    name: 'inner if has else - still detected with correct count',
    source: `
export function f(a: boolean, b: boolean) {
  if (a) {
    doA();
  } else {
    if (b) {
      doB();
    } else {
      doC();
    }
  }
}
`,
    statementsAffected: 3, // max(2, MIN_INNER_STMTS=3)
    score: 3,
  },
  {
    name: 'inner if with large branches - statementsAffected reflects real count',
    source: `
export function f(a: boolean, b: boolean) {
  if (a) {
    doA();
  } else {
    if (b) {
      doB();
      doC();
      doD();
    } else {
      doE();
      doF();
    }
  }
}
`,
    statementsAffected: 5, // 3 + 2 = 5 > MIN_INNER_STMTS
    score: 5,
  },
];

describe('analyzeCollapsibleIf', () => {
  it('analyzeCollapsibleIf - empty files array - returns empty', () => {
    // Arrange & Act
    const result = analyzeCollapsibleIf([]);

    // Assert
    expect(result).toEqual([]);
  });

  it('analyzeCollapsibleIf - empty function - returns no findings', () => {
    // Arrange
    const files = parse('export function empty() {}');
    // Act
    const result = analyzeCollapsibleIf(files);

    // Assert
    expect(result).toEqual([]);
  });

  it.each(noFindingCases)('analyzeCollapsibleIf - $name - returns no findings', ({ source }) => {
    // Arrange & Act
    expectNoFindings(source, analyzeCollapsibleIf);
  });

  it.each(collapsibleIfCases)(
    'analyzeCollapsibleIf - $name - returns collapsible-if',
    ({ source, score, depthReduction, statementsAffected }) => {
      // Arrange & Act
      const result = analyzeSource(source, analyzeCollapsibleIf);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]!.kind).toBe('collapsible-if');
      expect(result[0]!.score).toBe(score);
      expect(result[0]!.metrics.depthReduction).toBe(depthReduction);
      expect(result[0]!.metrics.statementsAffected).toBe(statementsAffected);
    },
  );

  // ── collapsible-else-if ─────────────────────────────────────────────

  it.each(elseIfCases)(
    'analyzeCollapsibleIf - collapsible-else-if: $name - returns collapsible-else-if',
    ({ source, statementsAffected, score }) => {
      // Arrange & Act
      const result = analyzeSource(source, analyzeCollapsibleIf);

      // Assert
      expectKind(result, 'collapsible-else-if');
      expect(result[0]!.metrics.depthReduction).toBe(1);
      expect(result[0]!.metrics.statementsAffected).toBe(statementsAffected);
      expect(result[0]!.score).toBe(score);
    },
  );

  it('analyzeCollapsibleIf - two independent collapsible-ifs in same function - aggregated', () => {
    // Arrange & Act
    const result = analyzeSource(
      `
export function f(a: boolean, b: boolean, c: boolean, d: boolean) {
  if (a) {
    if (b) {
      doA();
      doB();
      doC();
    }
  }
  if (c) {
    if (d) {
      doD();
      doE();
      doF();
    }
  }
}
`,
      analyzeCollapsibleIf,
    );

    // Assert — both are in same function, aggregated into one item
    expect(result).toHaveLength(1);
    expect(result[0]!.score).toBe(6);
    expect(result[0]!.metrics.depthReduction).toBe(2);
    expect(result[0]!.metrics.statementsAffected).toBe(6);
    expect(result[0]!.opportunitySpans).toHaveLength(2);
  });

  it('analyzeCollapsibleIf - collapsible-if + collapsible-else-if coexist - primaryOpportunity selects higher score', () => {
    // Arrange & Act — collapsible-if (score=3) + collapsible-else-if (score=5) in same function
    const result = analyzeSource(
      `
export function f(a: boolean, b: boolean, c: boolean, d: boolean) {
  if (a) {
    if (b) {
      doA();
      doB();
      doC();
    }
  }
  if (c) {
    doX();
  } else {
    if (d) {
      do1();
      do2();
      do3();
    } else {
      do4();
      do5();
    }
  }
}
`,
      analyzeCollapsibleIf,
    );

    // Assert — both detected, primary kind = collapsible-else-if (score=5 > 3)
    expectKind(result, 'collapsible-else-if');
    expect(result[0]!.score).toBe(8); // 3 + 5
    expect(result[0]!.opportunitySpans).toHaveLength(2);
  });

  it('analyzeCollapsibleIf - maxDepth is tracked', () => {
    // Arrange & Act
    const result = analyzeSource(
      `
export function f(a: boolean, b: boolean) {
  if (a) {
    if (b) {
      doA();
      doB();
      doC();
    }
  }
}
`,
      analyzeCollapsibleIf,
    );

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]!.metrics.maxDepth).toBeGreaterThanOrEqual(2);
  });
});
