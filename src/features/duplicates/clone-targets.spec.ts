import type { Node } from 'oxc-parser';

import { describe, expect, it } from 'bun:test';

import { collectOxcNodes } from '../../engine/ast/oxc-ast-utils';
import { parseSource } from '../../engine/ast/parse-source';
import { isDecisionlessSkeleton } from './clone-targets';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const firstNodeOfType = (source: string, type: string): Node => {
  const parsed = parseSource('spec.ts', source);
  const nodes = collectOxcNodes(parsed.program, n => n.type === type);

  expect(nodes.length).toBeGreaterThanOrEqual(1);

  return nodes[0]!;
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('isDecisionlessSkeleton', () => {
  // ── 골격: 단순 위임 (파라미터 무변형 단일 호출 반환) ──────────────────────

  it('should classify a param-passthrough method delegation as skeleton', () => {
    const node = firstNodeOfType(
      `class Facade { svc: Store; find(id: string) { return this.svc.find(id); } }`,
      'MethodDefinition',
    );

    expect(isDecisionlessSkeleton(node)).toBe(true);
  });

  it('should classify a zero-arg delegation as skeleton', () => {
    const node = firstNodeOfType(`function run() { return engine.start(); }`, 'FunctionDeclaration');

    expect(isDecisionlessSkeleton(node)).toBe(true);
  });

  it('should classify an arrow expression-body delegation as skeleton', () => {
    const node = firstNodeOfType(`const f = (id: string) => repo.find(id);`, 'ArrowFunctionExpression');

    expect(isDecisionlessSkeleton(node)).toBe(true);
  });

  // ── 골격 아님: 위임 + 로직 ────────────────────────────────────────────────

  it('should not classify delegation with a preceding transform as skeleton', () => {
    const node = firstNodeOfType(
      `class Facade { svc: Store; find(id: string) { const key = id.trim(); return this.svc.find(key); } }`,
      'MethodDefinition',
    );

    expect(isDecisionlessSkeleton(node)).toBe(false);
  });

  it('should not classify a call with transformed arguments as skeleton', () => {
    const node = firstNodeOfType(`function f(id: string) { return repo.find(id.trim()); }`, 'FunctionDeclaration');

    expect(isDecisionlessSkeleton(node)).toBe(false);
  });

  it('should not classify a call with non-param identifier arguments as skeleton', () => {
    const node = firstNodeOfType(`function f(id: string) { return repo.find(GLOBAL_KEY); }`, 'FunctionDeclaration');

    expect(isDecisionlessSkeleton(node)).toBe(false);
  });

  it('should not classify a non-call return as skeleton', () => {
    const node = firstNodeOfType(`function f(x: number) { return x; }`, 'FunctionDeclaration');

    expect(isDecisionlessSkeleton(node)).toBe(false);
  });

  it('should not classify a computed-callee delegation as skeleton', () => {
    const node = firstNodeOfType(`function f(id: string) { return handlers[id](id); }`, 'FunctionDeclaration');

    expect(isDecisionlessSkeleton(node)).toBe(false);
  });

  it('should not classify destructured-param delegation as skeleton', () => {
    const node = firstNodeOfType(`function f({ id }: { id: string }) { return repo.find(id); }`, 'FunctionDeclaration');

    expect(isDecisionlessSkeleton(node)).toBe(false);
  });

  // ── 골격: 빈 marker 타입 ──────────────────────────────────────────────────

  it('should classify an empty interface as skeleton', () => {
    const node = firstNodeOfType(`interface Marker {}`, 'TSInterfaceDeclaration');

    expect(isDecisionlessSkeleton(node)).toBe(true);
  });

  it('should classify an empty type-literal alias as skeleton', () => {
    const node = firstNodeOfType(`type Marker = {};`, 'TSTypeAliasDeclaration');

    expect(isDecisionlessSkeleton(node)).toBe(true);
  });

  it('should not classify an interface with members as skeleton', () => {
    const node = firstNodeOfType(`interface Config { host: string; }`, 'TSInterfaceDeclaration');

    expect(isDecisionlessSkeleton(node)).toBe(false);
  });

  it('should not classify a non-literal type alias as skeleton', () => {
    const node = firstNodeOfType(`type Score = number | string;`, 'TSTypeAliasDeclaration');

    expect(isDecisionlessSkeleton(node)).toBe(false);
  });

  // ── 클래스/일반 노드는 골격 판정 비대상 ──────────────────────────────────

  it('should not classify an empty class declaration as skeleton', () => {
    const node = firstNodeOfType(`class Empty {}`, 'ClassDeclaration');

    expect(isDecisionlessSkeleton(node)).toBe(false);
  });

  it('should classify a class with only abstract members as skeleton', () => {
    const node = firstNodeOfType(
      `abstract class A { abstract run(x: number): void; abstract get(id: string): number; }`,
      'ClassDeclaration',
    );

    expect(isDecisionlessSkeleton(node)).toBe(true);
  });

  it('should not classify a class with an implemented method as skeleton', () => {
    const node = firstNodeOfType(
      `abstract class A { abstract run(x: number): void; help(): number { return 1; } }`,
      'ClassDeclaration',
    );

    expect(isDecisionlessSkeleton(node)).toBe(false);
  });

  it('should not classify a multi-statement function as skeleton', () => {
    const node = firstNodeOfType(`function f(x: number) { const y = x * 2; return repo.find(y); }`, 'FunctionDeclaration');

    expect(isDecisionlessSkeleton(node)).toBe(false);
  });
});
