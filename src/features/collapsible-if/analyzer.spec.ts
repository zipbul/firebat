import { describe, expect, it } from 'bun:test';

import { analyzeCollapsibleIf } from './analyzer';
import { parseSource } from '../../engine/ast/parse-source';

describe('analyzeCollapsibleIf', () => {
  const parse = (source: string) => [parseSource('/virtual/test.ts', source)];

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

  it('analyzeCollapsibleIf - basic: if(a) { if(b) { 3 stmts } } - returns collapsible-if', () => {
    // Arrange
    const files = parse(`
export function f(a: boolean, b: boolean) {
  if (a) {
    if (b) {
      doA();
      doB();
      doC();
    }
  }
}
`);
    // Act
    const result = analyzeCollapsibleIf(files);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe('collapsible-if');
    expect(result[0]!.score).toBe(3);
    expect(result[0]!.metrics.depthReduction).toBe(1);
    expect(result[0]!.metrics.statementsAffected).toBe(3);
  });

  it('analyzeCollapsibleIf - if(a) { if(b) { 5 stmts } } - score scales with inner count', () => {
    // Arrange
    const files = parse(`
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
`);
    // Act
    const result = analyzeCollapsibleIf(files);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]!.score).toBe(5);
  });

  it('analyzeCollapsibleIf - outer has else - returns no findings', () => {
    // Arrange
    const files = parse(`
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
`);
    // Act
    const result = analyzeCollapsibleIf(files);

    // Assert
    expect(result).toEqual([]);
  });

  it('analyzeCollapsibleIf - inner has else - returns no findings', () => {
    // Arrange
    const files = parse(`
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
`);
    // Act
    const result = analyzeCollapsibleIf(files);

    // Assert
    expect(result).toEqual([]);
  });

  it('analyzeCollapsibleIf - outer body has 2+ stmts - returns no findings', () => {
    // Arrange — outer body has 2 stmts, not collapsible
    const files = parse(`
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
`);
    // Act
    const result = analyzeCollapsibleIf(files);

    // Assert
    expect(result).toEqual([]);
  });

  it('analyzeCollapsibleIf - inner consequent has 2 stmts - returns no findings (below threshold)', () => {
    // Arrange — inner only has 2 stmts, below MIN_INNER_STMTS=3
    const files = parse(`
export function f(a: boolean, b: boolean) {
  if (a) {
    if (b) {
      doA();
      doB();
    }
  }
}
`);
    // Act
    const result = analyzeCollapsibleIf(files);

    // Assert
    expect(result).toEqual([]);
  });

  it('analyzeCollapsibleIf - 3-level nesting: if(a){ if(b){ if(c){ 3 stmts } } } - detects if(b)+if(c) pair', () => {
    // Arrange — if(a) body has 1 stmt (if(b)), if(b) body has 1 stmt (if(c)), if(c) has 3 stmts
    // Only if(b)+if(c) pair is collapsible (if(b) outer, if(c) inner with 3 stmts)
    const files = parse(`
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
`);
    // Act
    const result = analyzeCollapsibleIf(files);

    // Assert — both if(a)+if(b) and if(b)+if(c) are detected since both have inner body = 1 stmt
    // if(a)+if(b): inner if(b) has 1 stmt (if(c)), but that's 1 stmt < 3 → no
    // if(b)+if(c): inner if(c) has 3 stmts → yes
    expect(result).toHaveLength(1);
    expect(result[0]!.score).toBe(3);
  });

  it('analyzeCollapsibleIf - class method - detects pattern', () => {
    // Arrange
    const files = parse(`
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
`);
    // Act
    const result = analyzeCollapsibleIf(files);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe('collapsible-if');
  });

  it('analyzeCollapsibleIf - inside loop - detects pattern', () => {
    // Arrange
    const files = parse(`
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
`);
    // Act
    const result = analyzeCollapsibleIf(files);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe('collapsible-if');
  });

  it('analyzeCollapsibleIf - nested function boundary - isolated', () => {
    // Arrange — inner function's collapsible-if should not leak to outer
    const files = parse(`
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
`);
    // Act
    const result = analyzeCollapsibleIf(files);

    // Assert — inner function has collapsible-if, outer does not
    expect(result).toHaveLength(1);
  });

  it('analyzeCollapsibleIf - inner consequent is single expression (no block) - returns no findings', () => {
    // Arrange — if(b) doA() — consequent is ExpressionStatement, not a block with 3+ stmts
    const files = parse(`
export function f(a: boolean, b: boolean) {
  if (a) {
    if (b) doA();
  }
}
`);
    // Act
    const result = analyzeCollapsibleIf(files);

    // Assert
    expect(result).toEqual([]);
  });

  it('analyzeCollapsibleIf - two independent collapsible-ifs in same function - aggregated', () => {
    // Arrange
    const files = parse(`
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
`);
    // Act
    const result = analyzeCollapsibleIf(files);

    // Assert — both are in same function, aggregated into one item
    expect(result).toHaveLength(1);
    expect(result[0]!.score).toBe(6);
    expect(result[0]!.metrics.depthReduction).toBe(2);
    expect(result[0]!.metrics.statementsAffected).toBe(6);
    expect(result[0]!.opportunitySpans).toHaveLength(2);
  });

  // ── collapsible-else-if ─────────────────────────────────────────────

  it('analyzeCollapsibleIf - collapsible-else-if: else { if(b) { ... } } - returns collapsible-else-if', () => {
    // Arrange
    const files = parse(`
export function f(a: boolean, b: boolean) {
  if (a) {
    doA();
  } else {
    if (b) {
      doB();
    }
  }
}
`);
    // Act
    const result = analyzeCollapsibleIf(files);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe('collapsible-else-if');
    expect(result[0]!.metrics.depthReduction).toBe(1);
    expect(result[0]!.metrics.statementsAffected).toBe(3); // max(1, MIN_INNER_STMTS=3)
    expect(result[0]!.score).toBe(3);
  });

  it('analyzeCollapsibleIf - collapsible-else-if: inner if has else - still detected with correct count', () => {
    // Arrange — inner if has else, matching Clippy collapsible_else_if behavior
    // consequent: 1 stmt (doB), alternate: 1 stmt (doC) → total 2, max(2, 3) = 3
    const files = parse(`
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
`);
    // Act
    const result = analyzeCollapsibleIf(files);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe('collapsible-else-if');
    expect(result[0]!.metrics.statementsAffected).toBe(3); // max(2, MIN_INNER_STMTS=3)
    expect(result[0]!.score).toBe(3);
  });

  it('analyzeCollapsibleIf - collapsible-else-if: inner if with large branches - statementsAffected reflects real count', () => {
    // Arrange — inner consequent: 3 stmts, inner alternate: 2 stmts → total 5
    const files = parse(`
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
`);
    // Act
    const result = analyzeCollapsibleIf(files);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe('collapsible-else-if');
    expect(result[0]!.metrics.statementsAffected).toBe(5); // 3 + 2 = 5 > MIN_INNER_STMTS
    expect(result[0]!.score).toBe(5);
  });

  it('analyzeCollapsibleIf - else block with 2+ stmts - returns no collapsible-else-if', () => {
    // Arrange — else block has 2 statements, not just a single if
    const files = parse(`
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
`);
    // Act
    const result = analyzeCollapsibleIf(files);

    // Assert
    expect(result).toEqual([]);
  });

  it('analyzeCollapsibleIf - already else-if: if(a){} else if(b){} - NOT detected as collapsible-else-if', () => {
    // Arrange — alternate is IfStatement directly (not wrapped in BlockStatement)
    const files = parse(`
export function f(a: boolean, b: boolean) {
  if (a) {
    doA();
  } else if (b) {
    doB();
    doC();
    doD();
  }
}
`);
    // Act
    const result = analyzeCollapsibleIf(files);

    // Assert — else-if is already collapsed, no further collapsing possible
    expect(result).toEqual([]);
  });

  it('analyzeCollapsibleIf - empty else block: else {} - NOT detected', () => {
    // Arrange — else block is empty (body.length === 0)
    const files = parse(`
export function f(a: boolean) {
  if (a) {
    doA();
  } else {
  }
}
`);
    // Act
    const result = analyzeCollapsibleIf(files);

    // Assert
    expect(result).toEqual([]);
  });

  it('analyzeCollapsibleIf - empty inner if consequent: else { if(b) {} } - NOT detected', () => {
    // Arrange — inner if has empty consequent (innerTotal === 0)
    const files = parse(`
export function f(a: boolean, b: boolean) {
  if (a) {
    doA();
  } else {
    if (b) {}
  }
}
`);
    // Act
    const result = analyzeCollapsibleIf(files);

    // Assert — empty inner if has no benefit from collapsing
    expect(result).toEqual([]);
  });

  it('analyzeCollapsibleIf - collapsible-if + collapsible-else-if coexist - primaryOpportunity selects higher score', () => {
    // Arrange — collapsible-if (score=3) + collapsible-else-if (score=5) in same function
    const files = parse(`
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
`);
    // Act
    const result = analyzeCollapsibleIf(files);

    // Assert — both detected, primary kind = collapsible-else-if (score=5 > 3)
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe('collapsible-else-if');
    expect(result[0]!.score).toBe(8); // 3 + 5
    expect(result[0]!.opportunitySpans).toHaveLength(2);
  });

  it('analyzeCollapsibleIf - else block with non-if stmt - returns no collapsible-else-if', () => {
    // Arrange — else block has a single statement but it's not an if
    const files = parse(`
export function f(a: boolean) {
  if (a) {
    doA();
  } else {
    doB();
  }
}
`);
    // Act
    const result = analyzeCollapsibleIf(files);

    // Assert
    expect(result).toEqual([]);
  });

  it('analyzeCollapsibleIf - maxDepth is tracked', () => {
    // Arrange
    const files = parse(`
export function f(a: boolean, b: boolean) {
  if (a) {
    if (b) {
      doA();
      doB();
      doC();
    }
  }
}
`);
    // Act
    const result = analyzeCollapsibleIf(files);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]!.metrics.maxDepth).toBeGreaterThanOrEqual(2);
  });
});
