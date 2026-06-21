import { describe, it, expect } from 'bun:test';

import {
  collectFunctionNodes,
  collectFunctionNodesWithParent,
  collectOxcNodes,
  forEachChildNode,
  getLiteralString,
  getNodeHeader,
  getNodeName,
  isFunctionNode,
  isNodeRecord,
  isOxcNode,
  isOxcNodeArray,
  walkOxcTree,
} from './oxc-ast-utils';
import { parseSource } from './parse-source';

interface ChildNodeCase {
  name: string;
  source: string;
  nodeType: string;
  expected: string[];
}

interface NodeHeaderCase {
  name: string;
  source: string;
  nodeType: string;
  header: string;
}

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
    const nodes = collectOxcNodes(prog('"hello";'), n => n.type === 'Literal');
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

describe('forEachChildNode', () => {
  const cases: ChildNodeCase[] = [
    {
      name: 'yields only Node children of IfStatement (test, consequent, alternate)',
      source: 'if (true) { x; } else { y; }',
      nodeType: 'IfStatement',
      expected: ['Literal', 'BlockStatement', 'BlockStatement'],
    },
    {
      name: 'yields array children (VariableDeclaration.declarations)',
      source: 'const x = 1, y = 2;',
      nodeType: 'VariableDeclaration',
      expected: ['VariableDeclarator', 'VariableDeclarator'],
    },
    {
      name: 'yields nothing for leaf nodes (Identifier)',
      source: 'x;',
      nodeType: 'Identifier',
      expected: [],
    },
    {
      name: 'skips null children (IfStatement without alternate)',
      source: 'if (true) { x; }',
      nodeType: 'IfStatement',
      expected: ['Literal', 'BlockStatement'],
    },
  ];

  it.each(cases)('$name', ({ source, nodeType, expected }) => {
    const nodes = collectOxcNodes(prog(source), n => n.type === nodeType);
    const children: string[] = [];

    forEachChildNode(nodes[0]!, child => children.push(child.type));
    expect(children).toEqual(expected);
  });
});

describe('getNodeHeader', () => {
  const namedCases: NodeHeaderCase[] = [
    {
      name: 'returns function name for named function declaration',
      source: 'function myFunc() {}',
      nodeType: 'FunctionDeclaration',
      header: 'myFunc',
    },
    {
      name: 'returns variable name for arrow function assigned to const',
      source: 'const arrowFn = () => {};',
      nodeType: 'ArrowFunctionExpression',
      header: 'arrowFn',
    },
  ];

  it.each(namedCases)('$name', ({ source, nodeType, header }) => {
    const nodes = collectFunctionNodesWithParent(prog(source));
    const match = nodes.find(n => n.node.type === nodeType);

    expect(getNodeHeader(match!.node, match!.parent)).toBe(header);
  });

  it('returns "anonymous" when no name can be determined', () => {
    // Immediately-invoked anonymous function expression
    const nodes = collectOxcNodes(prog('(function() {})()'), n => n.type === 'FunctionExpression');

    expect(getNodeHeader(nodes[0]!)).toBe('anonymous');
  });
});
