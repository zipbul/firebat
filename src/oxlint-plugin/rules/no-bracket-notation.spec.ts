import { describe, expect, it } from 'bun:test';

import type { AstNode, JsonValue, TemplateElementValue } from '../types';

import { applyFixes, setupRule } from '../../../test/integration/oxlint-plugin/utils/rule-test-kit';
import { noBracketNotationRule } from './no-bracket-notation';

function templateLiteral(cooked: string): AstNode {
  const templateValue: TemplateElementValue = { cooked };
  const quasiNode: AstNode = { type: 'TemplateElement', value: templateValue };

  return { type: 'TemplateLiteral', expressions: [], quasis: [quasiNode] };
}

describe('no-bracket-notation', () => {
  it.each<[string, AstNode, boolean, JsonValue[], string[]]>([
    ['string literal key is not allowed', { type: 'Literal', value: 'blocked' }, true, [], ['bracketNotation']],
    ['string literal keys are configured as allowed', { type: 'Literal', value: 'allowed' }, true, [{ allow: ['allowed'] }], []],
    ['member access is not computed', { type: 'Identifier', name: 'value' }, false, [], []],
    ['template literal key lacks expressions', templateLiteral('templated'), true, [], ['bracketNotation']],
    // Simplified structure: only the expressions array matters here.
    [
      'template literal has expressions',
      { type: 'TemplateLiteral', expressions: [{ type: 'Identifier', name: 'expr' }], quasis: [] },
      true,
      [],
      [],
    ],
    ['bracket notation key is numeric', { type: 'Literal', value: 0 }, true, [], []],
  ])('should produce expected reports when %s', (_label, property, computed, options, expectedMessageIds) => {
    // Arrange
    const { visitor, reports } = setupRule(noBracketNotationRule, { options });
    const memberNode: AstNode = { type: 'MemberExpression', computed, property };

    // Act
    visitor.MemberExpression(memberNode);

    // Assert
    expect(reports.map(report => report.messageId)).toEqual(expectedMessageIds);
  });

  it('should autofix when bracket notation is safe', () => {
    // Arrange
    const text = "obj['alpha']";
    const { visitor, reports } = setupRule(noBracketNotationRule, { text });

    // Act
    visitor.MemberExpression({
      type: 'MemberExpression',
      range: [0, text.length],
      object: { type: 'Identifier', name: 'obj', range: [0, 3] },
      property: { type: 'Literal', value: 'alpha', raw: "'alpha'", range: [4, 11] },
      computed: true,
    });

    // Assert
    expect(reports.length).toBe(1);
    expect(typeof reports[0]?.fix).toBe('function');

    const fixed = applyFixes(text, reports);

    expect(fixed).toBe('obj.alpha');

    // Arrange
    const { visitor: visitor2, reports: reports2 } = setupRule(noBracketNotationRule, { text: fixed });

    // Act
    visitor2.MemberExpression({
      type: 'MemberExpression',
      range: [0, fixed.length],
      object: { type: 'Identifier', name: 'obj', range: [0, 3] },
      property: { type: 'Identifier', name: 'alpha', range: [4, 9] },
      computed: false,
    });

    // Assert
    expect(reports2.length).toBe(0);
  });

  it.each<[string, string, [number, number]]>([
    ['key is unsafe', "obj['not-valid']", [4, 15]],
    ['bracket notation is multiline', "obj[\n'alpha'\n]", [5, 12]],
  ])('should refuse autofix when %s', (_label, text, propRange) => {
    // Arrange
    const { visitor, reports } = setupRule(noBracketNotationRule, { text });
    const raw = text.slice(propRange[0], propRange[1]);

    // Act
    visitor.MemberExpression({
      type: 'MemberExpression',
      range: [0, text.length],
      object: { type: 'Identifier', name: 'obj', range: [0, 3] },
      property: { type: 'Literal', value: raw.slice(1, -1), raw, range: propRange },
      computed: true,
    });

    // Assert
    expect(reports.length).toBe(1);
    expect(typeof reports[0]?.fix).toBe('function');

    const fixed = applyFixes(text, reports);

    expect(fixed).toBe(text);
  });
});
