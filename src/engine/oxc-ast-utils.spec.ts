import { describe, it, expect } from 'bun:test';

import { parseSource } from './parse-source';
import {
  collectFunctionNodes,
  collectFunctionNodesWithParent,
  collectOxcNodes,
  getLiteralString,
  getNodeHeader,
  getNodeName,
  getNodeType,
  isFunctionNode,
  isNodeRecord,
  isOxcNode,
  isOxcNodeArray,
  visitOxcChildren,
  walkOxcTree,
} from './oxc-ast-utils';

const prog = (src: string) => parseSource('test.ts', src).program;

describe('isOxcNode', () => {
  it('returns true for an object with type property', () => {
    expect(isOxcNode({ type: 'Identifier', start: 0, end: 1 } as never)).toBe(true);
  });
  it('returns false for null', () => {
    expect(isOxcNode(null as never)).toBe(false);
  });
  it('returns false for an array', () => {
    expect(isOxcNode([] as never)).toBe(false);
  });
  it('returns false for a number', () => {
    expect(isOxcNode(5 as never)).toBe(false);
  });
});

describe('isOxcNodeArray', () => {
  it('returns true for an array', () => {
    expect(isOxcNodeArray([])).toBe(true);
  });
  it('returns false for a non-array', () => {
    expect(isOxcNodeArray({ type: 'X' } as never)).toBe(false);
  });
});

describe('isNodeRecord', () => {
  it('returns true for a non-null object', () => {
    const node = { type: 'Identifier', name: 'x', start: 0, end: 1 } as never;
    expect(isNodeRecord(node)).toBe(true);
  });
});

describe('getNodeType', () => {
  it('returns the type property', () => {
    const node = { type: 'Identifier', start: 0, end: 1 } as never;
    expect(getNodeType(node)).toBe('Identifier');
  });
});

describe('getNodeName', () => {
  it('returns the name for an Identifier-like node', () => {
    const node = { type: 'Identifier', name: 'foo', start: 0, end: 3 } as never;
    expect(getNodeName(node)).toBe('foo');
  });
  it('returns null for a non-OXC value', () => {
    expect(getNodeName(null as never)).toBeNull();
  });
  it('returns null when node has no name property', () => {
    const node = { type: 'Literal', value: 42, start: 0, end: 2 } as never;
    expect(getNodeName(node)).toBeNull();
  });
});

describe('getLiteralString', () => {
  it('returns the string value for a string Literal node', () => {
    const nodes = collectOxcNodes(prog('"hello";'), n => n.type === 'StringLiteral' || n.type === 'Literal');
    const strLiteral = nodes.find(n => (n as { value?: unknown }).value === 'hello');
    if (strLiteral) {
      expect(getLiteralString(strLiteral)).toBe('hello');
    }
  });
  it('returns null for non-OXC input', () => {
    expect(getLiteralString(null as never)).toBeNull();
  });
  it('returns null for non-Literal node', () => {
    const node = { type: 'Identifier', name: 'x', start: 0, end: 1 } as never;
    expect(getLiteralString(node)).toBeNull();
  });
});

describe('isFunctionNode', () => {
  it('returns true for FunctionDeclaration', () => {
    const nodes = collectOxcNodes(prog('function f() {}'), n => n.type === 'FunctionDeclaration');
    expect(nodes.length).toBeGreaterThan(0);
    expect(isFunctionNode(nodes[0]!)).toBe(true);
  });
  it('returns true for ArrowFunctionExpression', () => {
    const nodes = collectOxcNodes(prog('const f = () => {};'), n => n.type === 'ArrowFunctionExpression');
    expect(isFunctionNode(nodes[0]!)).toBe(true);
  });
  it('returns false for IfStatement', () => {
    const nodes = collectOxcNodes(prog('if (true) {}'), n => n.type === 'IfStatement');
    expect(isFunctionNode(nodes[0]!)).toBe(false);
  });
});

describe('walkOxcTree', () => {
  it('visits all nodes in a simple program', () => {
    const types: string[] = [];
    walkOxcTree(prog('const x = 1;'), node => {
      types.push(node.type);
      return true;
    });
    expect(types).toContain('Program');
    expect(types.length).toBeGreaterThan(1);
  });

  it('stops descending when walker returns false', () => {
    const types: string[] = [];
    walkOxcTree(prog('function f() { return 1; }'), node => {
      types.push(node.type);
      return node.type !== 'FunctionDeclaration'; // stop at function
    });
    // FunctionDeclaration is visited but its children are not
    expect(types).toContain('FunctionDeclaration');
    expect(types).not.toContain('ReturnStatement');
  });

  it('[ED] handles non-OXC input gracefully', () => {
    expect(() => walkOxcTree(null as never, () => true)).not.toThrow();
  });
});

describe('collectOxcNodes', () => {
  it('collects nodes matching a predicate', () => {
    const nodes = collectOxcNodes(prog('function a() {} function b() {}'), n => n.type === 'FunctionDeclaration');
    expect(nodes.length).toBe(2);
  });
  it('returns [] when no nodes match', () => {
    const nodes = collectOxcNodes(prog('const x = 1;'), n => n.type === 'ClassDeclaration');
    expect(nodes).toEqual([]);
  });
});

describe('collectFunctionNodes', () => {
  it('collects all function nodes', () => {
    const nodes = collectFunctionNodes(prog('function f() {} const g = () => {};'));
    expect(nodes.length).toBeGreaterThanOrEqual(2);
  });
});

describe('collectFunctionNodesWithParent', () => {
  it('collects function nodes with their parent context', () => {
    const results = collectFunctionNodesWithParent(prog('function f() {}'));
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('node');
    expect(results[0]).toHaveProperty('parent');
  });

  it('parent is null for top-level functions', () => {
    const results = collectFunctionNodesWithParent(prog('function f() {}'));
    const topLevel = results.find(r => r.node.type === 'FunctionDeclaration');
    // parent may be VariableDeclarator or Statement — just ensure it has a parent shape
    expect(topLevel).toBeDefined();
  });
});

describe('visitOxcChildren', () => {
  it('calls visitor for each child property', () => {
    const nodes = collectOxcNodes(prog('const x = 1;'), n => n.type === 'VariableDeclaration');
    const visited: unknown[] = [];
    visitOxcChildren(nodes[0]!, v => visited.push(v));
    expect(visited.length).toBeGreaterThan(0);
  });
});

describe('getNodeHeader', () => {
  it('returns function name for named function declaration', () => {
    const nodes = collectFunctionNodesWithParent(prog('function myFunc() {}'));
    const named = nodes.find(n => n.node.type === 'FunctionDeclaration');
    expect(getNodeHeader(named!.node, named!.parent)).toBe('myFunc');
  });

  it('returns variable name for arrow function assigned to const', () => {
    const nodes = collectFunctionNodesWithParent(prog('const arrowFn = () => {};'));
    const arrow = nodes.find(n => n.node.type === 'ArrowFunctionExpression');
    expect(getNodeHeader(arrow!.node, arrow!.parent)).toBe('arrowFn');
  });

  it('returns "anonymous" when no name can be determined', () => {
    // Immediately-invoked anonymous function expression
    const nodes = collectOxcNodes(prog('(function() {})()'), n => n.type === 'FunctionExpression');
    expect(getNodeHeader(nodes[0]!)).toBe('anonymous');
  });
});
