import type { Node } from 'oxc-parser';

import type { NodeRecord, NodeValue, NodeWithValue } from './types';

import { normalizeForFingerprint } from './ast-normalizer';
import { hashString } from './hasher';

const isOxcNode = (value: NodeValue): value is Node =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && 'type' in value && typeof value.type === 'string';

const isOxcNodeArray = (value: NodeValue): value is ReadonlyArray<NodeValue> => {
  if (!Array.isArray(value)) {
    return false;
  }

  return true;
};

const isNodeRecord = (node: Node): node is NodeRecord => typeof node === 'object' && node !== null;

const isLiteralNode = (node: Node): node is NodeWithValue => node.type === 'Literal' && 'value' in node;

const pushLiteralValue = (node: Node, diffs: string[], includeLiteralValues: boolean): void => {
  if (!isLiteralNode(node)) {
    return;
  }

  if (!includeLiteralValues) {
    diffs.push('literal');

    return;
  }

  const value = node.value;

  if (typeof value === 'string') {
    diffs.push(`string:${value}`);

    return;
  }

  if (typeof value === 'number') {
    diffs.push(`number:${value}`);

    return;
  }

  if (typeof value === 'boolean') {
    diffs.push(`boolean:${value}`);

    return;
  }

  if (typeof value === 'bigint') {
    diffs.push(`bigint:${value.toString()}`);

    return;
  }

  if (value === null) {
    diffs.push('null');
  }
};

// Oxc AST structure needs normalization for fingerprinting.
// We traverse the AST and build a string representation of semantics.
// Ignore names, locations, comments.
// Focus on structure: types, operators, literals (optional, maybe normalized).

interface OxcFingerprintOptions {
  readonly includeLiteralValues: boolean;
  readonly includeIdentifierNames: boolean;
  readonly ignoredKeys?: ReadonlySet<string>;
}

const NORMALIZED_IGNORED_KEYS: ReadonlySet<string> = new Set([
  // TypeScript / declaration noise
  'typeAnnotation',
  'typeParameters',
  'typeArguments',
  'returnType',
  'implements',
  'declare',
  'definite',
  // Decorators / modifiers
  'decorators',
  'accessibility',
  'abstract',
  'override',
  'readonly',
  // Literal representation / directives
  'raw',
  'directive',
  // Export metadata
  'exportKind',
  'attributes',
  'specifiers',
  'source',
]);

const escapeFingerprintToken = (token: string): string => {
  // We use '\x00' as a join separator, so ensure tokens cannot contain it.
  return token.replace(/\x00/g, '\\0');
};

const createOxcFingerprintCore = (node: NodeValue, options: OxcFingerprintOptions): string => {
  const diffs: string[] = [];

  const visit = (n: NodeValue) => {
    if (isOxcNodeArray(n)) {
      for (const child of n) {
        visit(child);
      }

      return;
    }

    if (!isOxcNode(n)) {
      return;
    }

    // push Type
    if (n.type.length > 0) {
      diffs.push(n.type);
    }

    pushLiteralValue(n, diffs, options.includeLiteralValues);

    // push specific semantic properties
    // e.g. Operator for BinaryExpression
    if (isNodeRecord(n)) {
      const operatorValue = n.operator;

      if (typeof operatorValue === 'string' && operatorValue.length > 0) {
        diffs.push(operatorValue);
      }
    }

    // Recursively visit children
    // Using specific known keys for Oxc nodes to avoid noise would be better,
    // but generic traversal is safer for completeness unless we map *every* node type.
    // For 'Physical Limit', we might want a optimized traverser.
    // Let's stick to generic for now, optimizing later if profiled.

    if (!isNodeRecord(n)) {
      return;
    }

    const entries = Object.entries(n).sort((left, right) => left[0].localeCompare(right[0]));

    for (const [key, value] of entries) {
      if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'span' || key === 'comments') {
        continue;
      }

      if (options.ignoredKeys?.has(key)) {
        continue;
      }

      // Skip identifiers names to allow renaming-robust detection?
      // User said "strict". Usually strict means "exact match".
      // But renaming robust is "Type-2".
      // Let's check original spec: "Strict: 0 FP". Duplicate usually implies structure match.
      // If we include names, it's Type-1. If we exclude, it's Type-2.
      // Let's include names for "Strict" equality initially?
      // No, usually copy-paste detection ignores whitespace (Type-1).
      // Type-2 ignores variable names.
      // Let's ignore Identifier names for better detection but include value literals.
      if (key === 'name' && n.type === 'Identifier') {
        if (options.includeIdentifierNames) {
          const nameValue = (n as unknown as { name?: unknown }).name;
          const resolved = typeof nameValue === 'string' ? nameValue : '';

          diffs.push(`id:${resolved}`);
        } else {
          diffs.push('$ID');
        }

        continue;
      }

      visit(value);
    }
  };

  visit(node);

  const encoded = diffs.map(escapeFingerprintToken).join('\x00');

  return hashString(encoded);
};

export const createOxcFingerprintExact = (node: NodeValue): string =>
  createOxcFingerprintCore(node, { includeLiteralValues: true, includeIdentifierNames: true });

export const createOxcFingerprint = (node: NodeValue): string =>
  createOxcFingerprintCore(node, { includeLiteralValues: true, includeIdentifierNames: false });

export const createOxcFingerprintShape = (node: NodeValue): string =>
  createOxcFingerprintCore(node, { includeLiteralValues: false, includeIdentifierNames: false });

export const createOxcFingerprintNormalized = (node: NodeValue): string => {
  const normalized = normalizeForFingerprint(node);

  return createOxcFingerprintCore(normalized, {
    includeLiteralValues: false,
    includeIdentifierNames: false,
    ignoredKeys: NORMALIZED_IGNORED_KEYS,
  });
};
