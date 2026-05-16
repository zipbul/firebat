import type { Node } from 'oxc-parser';

import { visitorKeys } from 'oxc-parser';

import { hashString } from '../hasher';
import { normalizeForFingerprint } from './ast-normalizer';
import { isOxcNode } from './oxc-ast-utils';

const pushLiteralValue = (node: Node, diffs: string[], includeLiteralValues: boolean): void => {
  if (node.type !== 'Literal') {
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

const visitArrayItems = (arr: unknown[], visit: (n: Node) => void): void => {
  for (const item of arr) {
    if (isOxcNode(item)) {
      visit(item);
    }
  }
};

const visitChildValue = (value: unknown, visit: (n: Node) => void): void => {
  if (isOxcNode(value)) {
    visit(value);

    return;
  }

  if (Array.isArray(value)) {
    visitArrayItems(value, visit);
  }
};

const pushIdentifierToken = (rec: Record<string, unknown>, diffs: string[], includeIdentifierNames: boolean): void => {
  if (includeIdentifierNames) {
    const nameValue = rec.name;
    const resolved = typeof nameValue === 'string' ? nameValue : '';

    diffs.push(`id:${resolved}`);
  } else {
    diffs.push('$ID');
  }
};

const visitNodeChildren = (
  n: Node,
  rec: Record<string, unknown>,
  options: OxcFingerprintOptions,
  visit: (n: Node) => void,
): void => {
  const keys = visitorKeys[n.type];

  if (keys === undefined) {
    return;
  }

  const sortedKeys = [...keys].sort();

  for (const key of sortedKeys) {
    if (options.ignoredKeys?.has(key)) {
      continue;
    }

    visitChildValue(rec[key], visit);
  }
};

const createOxcFingerprintCore = (node: Node, options: OxcFingerprintOptions): string => {
  const diffs: string[] = [];

  const visit = (n: Node) => {
    // Parenthesized expressions carry no semantic meaning; descend into the wrapped
    // expression without pushing the wrapper so `(a + b)` and `a + b` produce the same fingerprint.
    if (n.type === 'ParenthesizedExpression') {
      visit(n.expression);

      return;
    }

    // push Type
    if (n.type.length > 0) {
      diffs.push(n.type);
    }

    pushLiteralValue(n, diffs, options.includeLiteralValues);

    // push operator (scalar property, not in visitorKeys)
    const rec = n as unknown as Record<string, unknown>;
    const operatorValue = rec.operator;

    if (typeof operatorValue === 'string' && operatorValue.length > 0) {
      diffs.push(operatorValue);
    }

    // Identifier name handling
    if (n.type === 'Identifier') {
      pushIdentifierToken(rec, diffs, options.includeIdentifierNames);
    }

    // Visit child nodes via visitorKeys (sorted for deterministic fingerprints)
    visitNodeChildren(n, rec, options, visit);
  };

  visit(node);

  const encoded = diffs.map(escapeFingerprintToken).join('\x00');

  return hashString(encoded);
};

export const createOxcFingerprintExact = (node: Node): string =>
  createOxcFingerprintCore(node, { includeLiteralValues: true, includeIdentifierNames: true });

export const createOxcFingerprint = (node: Node): string =>
  createOxcFingerprintCore(node, { includeLiteralValues: true, includeIdentifierNames: false });

export const createOxcFingerprintShape = (node: Node): string =>
  createOxcFingerprintCore(node, { includeLiteralValues: false, includeIdentifierNames: false });

export const createOxcFingerprintNormalized = (node: Node): string => {
  const normalized = normalizeForFingerprint(node);

  return createOxcFingerprintCore(normalized as Node, {
    includeLiteralValues: false,
    includeIdentifierNames: false,
    ignoredKeys: NORMALIZED_IGNORED_KEYS,
  });
};
