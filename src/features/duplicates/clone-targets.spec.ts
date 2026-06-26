import type { Node } from 'oxc-parser';

import { describe, expect, it } from 'bun:test';

import { firstNonEmpty } from '../../../test/integration/shared/test-kit';
import { collectOxcNodes } from '../../engine/ast/oxc-ast-utils';
import { countOxcSize } from '../../engine/ast/oxc-size-count';
import { parseSource } from '../../engine/ast/parse-source';
import { isBelowDecisionFloor, isDecisionlessSkeleton } from './clone-targets';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const firstNodeOfType = (source: string, type: string): Node => {
  const parsed = parseSource('spec.ts', source);

  return firstNonEmpty(collectOxcNodes(parsed.program, n => n.type === type)) as Node;
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

  // ── 골격: 항등 화살표 (`x => x`) ──────────────────────────────────────────

  it('should classify an identity arrow as skeleton', () => {
    const node = firstNodeOfType(`const f = (x: number) => x;`, 'ArrowFunctionExpression');

    expect(isDecisionlessSkeleton(node)).toBe(true);
  });

  it('should not classify a free-identifier-returning arrow as identity skeleton', () => {
    const node = firstNodeOfType(`const f = (x: number) => y;`, 'ArrowFunctionExpression');

    expect(isDecisionlessSkeleton(node)).toBe(false);
  });

  it('should not classify a two-param arrow returning one param as skeleton', () => {
    const node = firstNodeOfType(`const f = (a: number, b: number) => a;`, 'ArrowFunctionExpression');

    expect(isDecisionlessSkeleton(node)).toBe(false);
  });

  // ── 골격: 무인자 seed factory (`() => []`, `() => false`) ──────────────────

  it('should classify a nullary empty-array factory as skeleton', () => {
    const node = firstNodeOfType(`const f = () => [];`, 'ArrowFunctionExpression');

    expect(isDecisionlessSkeleton(node)).toBe(true);
  });

  it('should classify a nullary empty-object factory as skeleton', () => {
    const node = firstNodeOfType(`const f = () => ({});`, 'ArrowFunctionExpression');

    expect(isDecisionlessSkeleton(node)).toBe(true);
  });

  it('should classify a nullary undefined factory as skeleton', () => {
    const node = firstNodeOfType(`const f = () => undefined;`, 'ArrowFunctionExpression');

    expect(isDecisionlessSkeleton(node)).toBe(true);
  });

  it('should classify a nullary boolean-literal factory as skeleton', () => {
    const node = firstNodeOfType(`const f = () => false;`, 'ArrowFunctionExpression');

    expect(isDecisionlessSkeleton(node)).toBe(true);
  });

  it('should classify a nullary numeric-literal factory as skeleton', () => {
    const node = firstNodeOfType(`const f = () => 0;`, 'ArrowFunctionExpression');

    expect(isDecisionlessSkeleton(node)).toBe(true);
  });

  it('should classify a nullary async empty-array factory as skeleton', () => {
    const node = firstNodeOfType(`const f = async () => [];`, 'ArrowFunctionExpression');

    expect(isDecisionlessSkeleton(node)).toBe(true);
  });

  it('should not classify a nullary non-empty-array factory as skeleton', () => {
    const node = firstNodeOfType(`const f = () => [1];`, 'ArrowFunctionExpression');

    expect(isDecisionlessSkeleton(node)).toBe(false);
  });

  it('should not classify a nullary non-empty-object factory as skeleton', () => {
    const node = firstNodeOfType(`const f = () => ({ a: 1 });`, 'ArrowFunctionExpression');

    expect(isDecisionlessSkeleton(node)).toBe(false);
  });

  it('should not classify a nullary factory returning a computation as skeleton', () => {
    const node = firstNodeOfType(`const f = () => 1 + 1;`, 'ArrowFunctionExpression');

    expect(isDecisionlessSkeleton(node)).toBe(false);
  });

  it('should not classify a nullary factory returning a call with a free-id arg as seed skeleton', () => {
    // `() => make(SEED)` is not a seed literal, and not a passthrough delegation
    // (the argument is a free identifier, not a param) → carries a decision.
    const node = firstNodeOfType(`const f = () => make(SEED);`, 'ArrowFunctionExpression');

    expect(isDecisionlessSkeleton(node)).toBe(false);
  });

  it('should not classify a one-param literal-returning arrow as nullary factory', () => {
    const node = firstNodeOfType(`const f = (x: number) => 0;`, 'ArrowFunctionExpression');

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

describe('isBelowDecisionFloor', () => {
  // 결정-존재 floor는 익명 인라인 표현식에만 적용. floor=12를 기준으로 BVA.

  it('should classify a tiny numeric-comparator arrow as below the floor', () => {
    // `(a, b) => a - b` size≈6 < 12 — 우연히 같은 비교자 (독립 결정의 동형)
    const node = firstNodeOfType(`const z = xs.sort((a, b) => a - b);`, 'ArrowFunctionExpression');

    expect(countOxcSize(node)).toBeLessThan(12);
    expect(isBelowDecisionFloor(node, 12)).toBe(true);
  });

  it('should classify a tiny non-empty predicate arrow as below the floor', () => {
    const node = firstNodeOfType(`const z = xs.filter(s => s.length > 0);`, 'ArrowFunctionExpression');

    expect(isBelowDecisionFloor(node, 12)).toBe(true);
  });

  it('should classify a tiny single-call projection arrow as below the floor', () => {
    const node = firstNodeOfType(`const z = xs.map(n => join(dir, n));`, 'ArrowFunctionExpression');

    expect(isBelowDecisionFloor(node, 12)).toBe(true);
  });

  it('should NOT classify an arrow at exactly the floor size as below it (BVA boundary)', () => {
    // size == minSize 는 floor 통과 (fragment 규칙과 동일: size >= minSize 이면 결정 충분).
    const node = firstNodeOfType('const z = xs.map(u => `${u.name}@${u.location}`);', 'ArrowFunctionExpression');

    expect(countOxcSize(node)).toBe(12);
    expect(isBelowDecisionFloor(node, 12)).toBe(false);
  });

  it('should NOT classify a large anonymous arrow as below the floor', () => {
    const node = firstNodeOfType(
      `const z = xs.map(u => { const a = u.x + u.y; const b = a * u.z; return a + b + u.w; });`,
      'ArrowFunctionExpression',
    );

    expect(isBelowDecisionFloor(node, 12)).toBe(false);
  });

  it('should NOT apply the floor to a tiny NAMED function declaration', () => {
    // 명명 선언은 작아도 주소 지정 가능한 변경지점 — floor 비대상 (false negative 방지).
    const node = firstNodeOfType(`function add(a, b) { return a + b; }`, 'FunctionDeclaration');

    expect(countOxcSize(node)).toBeLessThan(12);
    expect(isBelowDecisionFloor(node, 12)).toBe(false);
  });

  it('should NOT apply the floor to a tiny class declaration', () => {
    const node = firstNodeOfType(`class C { x = 1; }`, 'ClassDeclaration');

    expect(isBelowDecisionFloor(node, 12)).toBe(false);
  });

  it('should NOT apply the floor to a tiny type alias', () => {
    const node = firstNodeOfType(`type T = { a: number };`, 'TSTypeAliasDeclaration');

    expect(isBelowDecisionFloor(node, 12)).toBe(false);
  });

  it('should apply the floor to a tiny anonymous function expression', () => {
    const node = firstNodeOfType(`const z = xs.map(function (n) { return n + 1; });`, 'FunctionExpression');

    expect(isBelowDecisionFloor(node, 12)).toBe(true);
  });

  it('should NOT apply the floor to a NAMED function expression (named binding is a changepoint)', () => {
    const node = firstNodeOfType(`const z = xs.map(function inc(n) { return n + 1; });`, 'FunctionExpression');

    expect(isBelowDecisionFloor(node, 12)).toBe(false);
  });
});
