import { describe, expect, it } from 'bun:test';

import type { AstNode, TemplateElementValue } from '../types';

import { applyFixes, setupRule } from '../../../test/integration/oxlint-plugin/utils/rule-test-kit';
import { noBracketNotationRule } from './no-bracket-notation';

describe('no-bracket-notation', () => {
  it('should report when string literal key is not allowed', () => {
    // Arrange
    const { visitor, reports } = setupRule(noBracketNotationRule);
    const propertyNode: AstNode = { type: 'Literal', value: 'blocked' };
    const memberNode: AstNode = { type: 'MemberExpression', computed: true, property: propertyNode };

    // Act
    visitor.MemberExpression(memberNode);

    // Assert
    expect(reports.length).toBe(1);
    expect(reports[0]?.messageId).toBe('bracketNotation');
  });

  it('should allow string literal keys when configured', () => {
    // Arrange
    const { visitor, reports } = setupRule(noBracketNotationRule, { options: [{ allow: ['allowed'] }] });
    const propertyNode: AstNode = { type: 'Literal', value: 'allowed' };
    const memberNode: AstNode = { type: 'MemberExpression', computed: true, property: propertyNode };

    // Act
    visitor.MemberExpression(memberNode);

    // Assert
    expect(reports.length).toBe(0);
  });

  it('should ignore member access when not computed', () => {
    // Arrange
    const { visitor, reports } = setupRule(noBracketNotationRule);
    const propertyNode: AstNode = { type: 'Identifier', name: 'value' };
    const memberNode: AstNode = { type: 'MemberExpression', computed: false, property: propertyNode };

    // Act
    visitor.MemberExpression(memberNode);

    // Assert
    expect(reports.length).toBe(0);
  });

  it('should report when template literal key lacks expressions', () => {
    // Arrange
    const { visitor, reports } = setupRule(noBracketNotationRule);
    const templateValue: TemplateElementValue = { cooked: 'templated' };
    const quasiNode: AstNode = { type: 'TemplateElement', value: templateValue };
    const templateNode: AstNode = { type: 'TemplateLiteral', expressions: [], quasis: [quasiNode] };
    const memberNode: AstNode = { type: 'MemberExpression', computed: true, property: templateNode };

    // Act
    visitor.MemberExpression(memberNode);

    // Assert
    expect(reports.length).toBe(1);
    expect(reports[0]?.messageId).toBe('bracketNotation');
  });

  it('should ignore template literals when expressions exist', () => {
    // Arrange
    const { visitor, reports } = setupRule(noBracketNotationRule);
    const templateNode: AstNode = {
      type: 'TemplateLiteral',
      expressions: [{ type: 'Identifier', name: 'expr' }],
      quasis: [], // Simplified structure
    };
    const memberNode: AstNode = { type: 'MemberExpression', computed: true, property: templateNode };

    // Act
    visitor.MemberExpression(memberNode);

    // Assert
    expect(reports.length).toBe(0);
  });

  it('should ignore bracket notation when key is numeric', () => {
    // Arrange
    const { visitor, reports } = setupRule(noBracketNotationRule);
    const propertyNode: AstNode = { type: 'Literal', value: 0 };
    const memberNode: AstNode = { type: 'MemberExpression', computed: true, property: propertyNode };

    // Act
    visitor.MemberExpression(memberNode);

    // Assert
    expect(reports.length).toBe(0);
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

  it('should refuse autofix when key is unsafe', () => {
    // Arrange
    const text = "obj['not-valid']";
    const { visitor, reports } = setupRule(noBracketNotationRule, { text });

    // Act
    visitor.MemberExpression({
      type: 'MemberExpression',
      range: [0, text.length],
      object: { type: 'Identifier', name: 'obj', range: [0, 3] },
      property: { type: 'Literal', value: 'not-valid', raw: "'not-valid'", range: [4, 15] },
      computed: true,
    });

    // Assert
    expect(reports.length).toBe(1);
    expect(typeof reports[0]?.fix).toBe('function');

    const fixed = applyFixes(text, reports);

    expect(fixed).toBe(text);
  });

  it('should refuse autofix when bracket notation is multiline', () => {
    // Arrange
    const text = "obj[\n'alpha'\n]";
    const { visitor, reports } = setupRule(noBracketNotationRule, { text });

    // Act
    visitor.MemberExpression({
      type: 'MemberExpression',
      range: [0, text.length],
      object: { type: 'Identifier', name: 'obj', range: [0, 3] },
      property: { type: 'Literal', value: 'alpha', raw: "'alpha'", range: [5, 12] },
      computed: true,
    });

    // Assert
    expect(reports.length).toBe(1);
    expect(typeof reports[0]?.fix).toBe('function');

    const fixed = applyFixes(text, reports);

    expect(fixed).toBe(text);
  });
});
