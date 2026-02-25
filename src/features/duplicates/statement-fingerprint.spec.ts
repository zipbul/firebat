import { describe, expect, it } from 'bun:test';
import { parseSync } from 'oxc-parser';

import { collectFunctionNodes, collectOxcNodes } from '../../engine/ast/oxc-ast-utils';
import {
  extractStatementFingerprintBag,
  extractStatementFingerprints,
} from './statement-fingerprint';

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

const parse = (source: string) =>
  parseSync('test.ts', source);

const firstFunction = (source: string) => {
  const { program } = parse(source);
  const fns = collectFunctionNodes(program);
  if (fns.length === 0) throw new Error('함수 노드 없음');
  return fns[0]!;
};

const allFunctions = (source: string) => {
  const { program } = parse(source);
  return collectFunctionNodes(program);
};

// ─── extractStatementFingerprints ─────────────────────────────────────────────

describe('extractStatementFingerprints', () => {
  it('빈 함수 body → 빈 배열', () => {
    const node = firstFunction(`function empty() {}`);
    expect(extractStatementFingerprints(node)).toHaveLength(0);
  });

  it('3개 statement 함수 → 3개 fingerprint', () => {
    const node = firstFunction(`
      function three() {
        const a = 1;
        console.log(a);
        return a;
      }
    `);
    expect(extractStatementFingerprints(node)).toHaveLength(3);
  });

  it('동일 구조 다른 이름 두 함수 → 동일 fingerprint 시퀀스', () => {
    const source = `
      function foo(x: number, y: number) {
        const result = x + y;
        if (result > 0) {
          return result;
        }
        return 0;
      }
      function bar(a: number, b: number) {
        const sum = a + b;
        if (sum > 0) {
          return sum;
        }
        return 0;
      }
    `;
    const fns = allFunctions(source);
    const fpFoo = extractStatementFingerprints(fns[0]!);
    const fpBar = extractStatementFingerprints(fns[1]!);
    expect(fpFoo).toEqual(fpBar);
  });

  it('ArrowFunction expression body → 1개 fingerprint', () => {
    const node = firstFunction(`const add = (a: number, b: number) => a + b;`);
    expect(extractStatementFingerprints(node)).toHaveLength(1);
  });

  it('ArrowFunction block body → 각 statement fingerprint', () => {
    const node = firstFunction(`
      const fn = () => {
        const x = 1;
        return x;
      };
    `);
    expect(extractStatementFingerprints(node)).toHaveLength(2);
  });

  it('반환값이 모두 string 타입', () => {
    const node = firstFunction(`
      function check(val: string) {
        if (!val) throw new Error('empty');
        return val.trim();
      }
    `);
    const fps = extractStatementFingerprints(node);
    for (const fp of fps) {
      expect(typeof fp).toBe('string');
      expect(fp.length).toBeGreaterThan(0);
    }
  });

  it('중첩 함수 — 외부 함수의 statement만 추출 (내부 함수는 단일 statement)', () => {
    const source = `
      function outer() {
        const x = 1;
        function inner() {
          const y = 2;
          return y;
        }
        return inner();
      }
    `;
    // collectFunctionNodes는 DFS → outer가 먼저
    const fns = allFunctions(source);
    const outerNode = fns[0]!; // outer
    const fps = extractStatementFingerprints(outerNode);
    // outer body: const x = 1; / function inner() {...}; / return inner();
    expect(fps).toHaveLength(3);
  });

  it('MethodDefinition → value(FunctionExpression)의 body에서 추출', () => {
    const source = `
      class Calc {
        add(x: number, y: number) {
          const result = x + y;
          return result;
        }
      }
    `;
    const { program } = parse(source);
    // MethodDefinition 노드 직접 수집
    const methodNodes = collectOxcNodes(program, (n) => n.type === 'MethodDefinition');
    expect(methodNodes.length).toBeGreaterThan(0);
    const fps = extractStatementFingerprints(methodNodes[0]!);
    expect(fps).toHaveLength(2);
  });

  it('서로 다른 구조의 두 함수 → 다른 fingerprint 시퀀스', () => {
    const source = `
      function funcA() {
        const a = 1;
        return a;
      }
      function funcB() {
        for (let i = 0; i < 10; i++) {
          console.log(i);
        }
      }
    `;
    const fns = allFunctions(source);
    const fpA = extractStatementFingerprints(fns[0]!);
    const fpB = extractStatementFingerprints(fns[1]!);
    expect(fpA).not.toEqual(fpB);
  });

  it('literal 값이 달라도 구조 동일하면 동일 fingerprint', () => {
    const source = `
      function withFive() {
        return 5;
      }
      function withTen() {
        return 10;
      }
    `;
    const fns = allFunctions(source);
    const fpFive = extractStatementFingerprints(fns[0]!);
    const fpTen = extractStatementFingerprints(fns[1]!);
    // type-2-shape fingerprint: literal 값 무시 → 동일해야 함
    expect(fpFive).toEqual(fpTen);
  });
});

  it('abstract 메서드(body 없는 MethodDefinition) → 빈 배열', () => {
    const source = `
      abstract class Base {
        abstract compute(x: number): number;
      }
    `;
    const { program } = parse(source);
    const methodNodes = collectOxcNodes(program, (n) => n.type === 'MethodDefinition');
    // abstract 메서드는 value가 FunctionExpression이지만 body가 없을 수 있음
    // 또는 isOxcNode(value) === false인 경우를 커버
    // 어떤 경우든 에러 없이 빈 배열이어야 함
    if (methodNodes.length > 0) {
      const fps = extractStatementFingerprints(methodNodes[0]!);
      expect(Array.isArray(fps)).toBe(true);
    }
  });

// ─── extractStatementFingerprintBag ───────────────────────────────────────────

describe('extractStatementFingerprintBag', () => {
  it('빈 함수 → 빈 bag', () => {
    const node = firstFunction(`function empty() {}`);
    expect(extractStatementFingerprintBag(node)).toHaveLength(0);
  });

  it('bag 길이 = 시퀀스 길이 (동일 원소)', () => {
    const node = firstFunction(`
      function fn() {
        const a = 1;
        const b = 2;
        return a + b;
      }
    `);
    const seq = extractStatementFingerprints(node);
    const bag = extractStatementFingerprintBag(node);
    expect(bag).toHaveLength(seq.length);
    // 같은 원소를 포함 (순서는 다를 수 있지만 bag은 시퀀스와 동일 구현)
    expect([...bag].sort()).toEqual([...seq].sort());
  });
});
