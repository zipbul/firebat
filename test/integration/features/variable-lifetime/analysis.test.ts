import { describe, expect, it } from 'bun:test';

import { expectBaseFinding, scanDetectorFindings } from '../../shared/scan-fixture';

const VARIABLE_LIFETIME_KINDS: ReadonlyArray<string> = [
  'variable-lifetime',
  'scope-narrowing',
  'liveness-pressure',
  'mutation-density',
];

const fillerConsts = (count: number, name: string): string => {
  return Array.from({ length: count }, (_, i) => `  const ${name}${i} = ${i};`).join('\n');
};

/** 8 variables all live at the return of a padded ~50-line function. */
const eightLiveVarsSource = (fnName: string): string => {
  return [
    `export function ${fnName}() {`,
    '  const a = 1;',
    '  const b = 2;',
    '  const c = 3;',
    '  const d = 4;',
    '  const e = 5;',
    '  const f = 6;',
    '  const g = 7;',
    '  const h = 8;',
    fillerConsts(45, 'pad'),
    '  return a + b + c + d + e + f + g + h;',
    '}',
  ].join('\n');
};

describe('integration/variable-lifetime', () => {
  it('should report long-lived variables when definition-to-last-use spans many lines', async () => {
    // Act
    const list = await scanDetectorFindings('p1-var-life-1', 'variable-lifetime', {
      'src/a.ts': ['export function f() {', '  const config = { a: 1 };', fillerConsts(90, 'x'), '  return config.a;', '}'].join(
        '\n',
      ),
    });

    // Assert
    expect(list.length).toBeGreaterThan(0);

    for (const item of list) {
      expectBaseFinding(item, VARIABLE_LIFETIME_KINDS);
    }
  });

  it('should report context burden when multiple long-lived variables exist', async () => {
    // Act
    const list = await scanDetectorFindings('p1-var-life-2', 'variable-lifetime', {
      'src/a.ts': [
        'export function f() {',
        '  const a = 1;',
        '  const b = 2;',
        fillerConsts(60, 'x'),
        '  return a + b;',
        '}',
      ].join('\n'),
    });

    // Assert
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]?.contextBurden).toBeDefined();
    expect(typeof list[0]?.contextBurden).toBe('number');
    expect(list[0]?.contextBurden).toBeGreaterThan(0);
  });

  it('should report multiple variables when several lifetimes exceed the threshold', async () => {
    // Act
    const list = await scanDetectorFindings('p1-var-life-3', 'variable-lifetime', {
      'src/a.ts': [
        'export function f() {',
        '  const a = 1;',
        '  const b = 2;',
        fillerConsts(80, 'y'),
        '  return a + b;',
        '}',
      ].join('\n'),
    });

    // Assert
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  it('should support config threshold maxLifetimeLines when configuration is present', async () => {
    // Act
    const list = await scanDetectorFindings('p1-var-life-4', 'variable-lifetime', {
      '.firebatrc.jsonc': '{\n  "features": { "variable-lifetime": { "maxLifetimeLines": 5 } }\n}',
      'src/a.ts': [
        'export function f() {',
        '  const a = 1;',
        '  const x = 0;',
        '  const y = 1;',
        '  const z = 2;',
        '  return a + x + y + z;',
        '}',
      ].join('\n'),
    });

    // Assert
    expect(Array.isArray(list)).toBe(true);
  });

  it('should not emit natural-language fields in variable-lifetime findings', async () => {
    // Act
    const list = await scanDetectorFindings('p1-var-life-5', 'variable-lifetime', {
      'src/a.ts': 'export const f = () => 1;',
    });

    // Assert
    for (const item of list) {
      expectBaseFinding(item, VARIABLE_LIFETIME_KINDS);
      expect(item.message).toBeUndefined();
      expect(item.why).toBeUndefined();
      expect(item.suggestedRefactor).toBeUndefined();
    }
  });

  it('should not report variable lifetime when definition-to-last-use is short', async () => {
    // Act
    const list = await scanDetectorFindings('p1-var-life-neg-1', 'variable-lifetime', {
      'src/a.ts': ['export function f() {', '  const a = 1;', '  return a + 1;', '}'].join('\n'),
    });

    // Assert
    expect(list.length).toBe(0);
  });

  it('should emit liveness-pressure finding when maxLiveVariables and minFunctionLines are configured', async () => {
    // Arrange: 8 vars all live at return, 50-line function; config sets maxLiveVariables:7, minFunctionLines:10
    const list = await scanDetectorFindings('p1-var-life-liveness-1', 'variable-lifetime', {
      '.firebatrc.jsonc':
        '{\n  "features": { "variable-lifetime": { "maxLifetimeLines": 999, "maxLiveVariables": 7, "minFunctionLines": 10 } }\n}',
      'src/a.ts': eightLiveVarsSource('bigFn'),
    });
    // Assert
    const pressureFindings = list.filter((item: any) => item.kind === 'liveness-pressure');

    expect(pressureFindings.length).toBeGreaterThanOrEqual(1);
    expect(pressureFindings[0]?.maxLiveVariables).toBeGreaterThanOrEqual(7);
    expect(typeof pressureFindings[0]?.functionLineCount).toBe('number');
    expect(pressureFindings[0]?.functionLineCount).toBeGreaterThanOrEqual(10);
    expect(typeof pressureFindings[0]?.hotSpotLine).toBe('number');
  });

  it('should not emit liveness-pressure finding when maxLiveVariables is set very high in config', async () => {
    // Arrange: 8 vars all live at return, 50-line function; config sets maxLiveVariables to 999 → no fire
    const list = await scanDetectorFindings('p1-var-life-liveness-2', 'variable-lifetime', {
      '.firebatrc.jsonc':
        '{\n  "features": { "variable-lifetime": { "maxLifetimeLines": 999, "maxLiveVariables": 999, "minFunctionLines": 10 } }\n}',
      'src/a.ts': eightLiveVarsSource('bigFnHighThreshold'),
    });
    // Assert — no liveness-pressure because maxLiveVariables threshold (999) is above actual live count
    const pressureFindings = list.filter((item: any) => item.kind === 'liveness-pressure');

    expect(pressureFindings.length).toBe(0);
  });
});
