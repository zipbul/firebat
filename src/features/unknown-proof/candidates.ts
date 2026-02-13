import type { Node } from 'oxc-parser';

import * as path from 'node:path';

import type { ParsedFile } from '../../engine/types';
import type { SourceSpan, UnknownProofFinding } from '../../types';

import { isNodeRecord, walkOxcTree } from '../../engine/oxc-ast-utils';
import { getLineColumn } from '../../engine/source-position';

interface BindingCandidate {
  readonly name: string;
  readonly offset: number;
  readonly span: SourceSpan;
}

type BoundaryUsageKind = 'call' | 'assign' | 'store' | 'return' | 'throw';

interface BoundaryUsageCandidate {
  readonly name: string;
  readonly offset: number;
  readonly span: SourceSpan;
  readonly usageKind: BoundaryUsageKind;
}

type NodeLike = Record<string, unknown>;

interface UnknownProofCandidates {
  readonly typeAssertionFindings: ReadonlyArray<UnknownProofFinding>;
  readonly nonBoundaryBindings: ReadonlyArray<BindingCandidate>;
  readonly boundaryUnknownUsages: ReadonlyArray<BoundaryUsageCandidate>;
}

interface CollectUnknownProofCandidatesInput {
  readonly program: ReadonlyArray<ParsedFile>;
  readonly rootAbs: string;
  readonly boundaryGlobs?: ReadonlyArray<string>;
}

interface CollectUnknownProofCandidatesOutput {
  readonly boundaryGlobs: ReadonlyArray<string>;
  readonly perFile: ReadonlyMap<string, UnknownProofCandidates>;
}

interface CollectBoundaryUnknownUsagesInput {
  readonly program: unknown;
  readonly sourceText: string;
  readonly unknownBindings: ReadonlyArray<BindingCandidate>;
}

const normalizePath = (value: string): string => value.replaceAll('\\', '/');

const toRelPath = (rootAbs: string, fileAbs: string): string => {
  const rel = path.relative(rootAbs, fileAbs);

  return normalizePath(rel);
};

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const globToRegExp = (pattern: string): RegExp => {
  // Supports: **, *, ?, and path separators '/'.
  // - ** matches any characters including '/'
  // - * matches any characters except '/'
  let out = '^';
  let i = 0;

  while (i < pattern.length) {
    const ch = pattern[i] ?? '';

    if (ch === '*') {
      const next = pattern[i + 1];

      if (next === '*') {
        out += '.*';
        i += 2;

        continue;
      }

      out += '[^/]*';
      i += 1;

      continue;
    }

    if (ch === '?') {
      out += '[^/]';
      i += 1;

      continue;
    }

    out += escapeRegex(ch);
    i += 1;
  }

  out += '$';

  return new RegExp(out);
};

const compileGlobs = (patterns: ReadonlyArray<string>): ReadonlyArray<RegExp> => {
  return patterns
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .map(p => globToRegExp(normalizePath(p)));
};

const isBoundaryFile = (rootAbs: string, fileAbs: string, boundaryGlobs: ReadonlyArray<RegExp>): boolean => {
  const rel = toRelPath(rootAbs, fileAbs);

  if (rel.startsWith('..')) {
    return false;
  }

  return boundaryGlobs.some(re => re.test(rel));
};

const toSpanFromOffsets = (sourceText: string, startOffset: number, endOffset: number): SourceSpan => {
  const start = getLineColumn(sourceText, Math.max(0, startOffset));
  const end = getLineColumn(sourceText, Math.max(0, endOffset));

  return { start, end };
};

const asNodeLike = (value: unknown): NodeLike | null => {
  if (value === null || typeof value !== 'object') {
    return null;
  }

  return value as NodeLike;
};

const collectStringsFromNode = (node: unknown): string[] => {
  const out: string[] = [];

  const visit = (value: unknown): void => {
    if (value === null || value === undefined) {
      return;
    }

    if (typeof value === 'string') {
      out.push(value);

      return;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        visit(entry);
      }

      return;
    }

    if (typeof value === 'object') {
      for (const v of Object.values(value)) {
        visit(v);
      }
    }
  };

  visit(node);

  return out;
};

const containsTsKeyword = (node: unknown, keywordType: 'TSUnknownKeyword' | 'TSAnyKeyword'): boolean => {
  let found = false;

  walkOxcTree(node as Node, (n: Node) => {
    if (n.type === keywordType) {
      found = true;

      return false;
    }

    return true;
  });

  return found;
};

const extractBindingIdentifiers = (pattern: unknown): ReadonlyArray<NodeLike> => {
  const patternNode = asNodeLike(pattern);

  if (!patternNode) {
    return [];
  }

  if (patternNode.type === 'Identifier') {
    return [patternNode];
  }

  if (patternNode.type === 'AssignmentPattern') {
    return extractBindingIdentifiers(patternNode.left);
  }

  if (patternNode.type === 'RestElement') {
    return extractBindingIdentifiers(patternNode.argument);
  }

  return [];
};

const collectUnknownAnnotatedBindings = (program: unknown, sourceText: string): ReadonlyArray<BindingCandidate> => {
  const out: BindingCandidate[] = [];

  const addIfUnknown = (id: unknown): void => {
    const idNode = asNodeLike(id);

    if (!idNode || idNode.type !== 'Identifier' || typeof idNode.name !== 'string') {
      return;
    }

    const typeAnn = idNode.typeAnnotation;

    if (!typeAnn || !containsTsKeyword(typeAnn, 'TSUnknownKeyword')) {
      return;
    }

    const startOffset = typeof idNode.start === 'number' ? idNode.start : 0;
    const endOffset = typeof idNode.end === 'number' ? idNode.end : startOffset;

    out.push({ name: idNode.name, offset: startOffset, span: toSpanFromOffsets(sourceText, startOffset, endOffset) });
  };

  walkOxcTree(program as Node, (node: Node) => {
    if (!isNodeRecord(node)) {
      return true;
    }

    if (node.type === 'VariableDeclarator') {
      const ids = extractBindingIdentifiers(asNodeLike(node)?.id);

      for (const id of ids) {
        addIfUnknown(id);
      }
    }

    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
      const params = asNodeLike(node)?.params;

      if (Array.isArray(params)) {
        for (const p of params) {
          const ids = extractBindingIdentifiers(p);

          for (const id of ids) {
            addIfUnknown(id);
          }
        }
      }
    }

    return true;
  });

  return out;
};

interface WalkStackEntry {
  readonly node: unknown;
  readonly keyInParent: string | null;
}

const walkOxcTreeWithStack = (root: unknown, visit: (node: unknown, stack: ReadonlyArray<WalkStackEntry>) => void): void => {
  const seen = new Set<NodeLike>();

  const rec = (value: unknown, keyInParent: string | null, stack: ReadonlyArray<WalkStackEntry>): void => {
    if (value === null || value === undefined) {
      return;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        rec(entry, keyInParent, stack);
      }

      return;
    }

    if (typeof value !== 'object') {
      return;
    }

    if (!isNodeRecord(value as Node)) {
      for (const [k, v] of Object.entries(value)) {
        rec(v, k, stack);
      }

      return;
    }

    if (seen.has(value as NodeLike)) {
      return;
    }

    seen.add(value as NodeLike);

    const nextStack = [...stack, { node: value, keyInParent }];

    visit(value, nextStack);

    for (const [k, v] of Object.entries(value)) {
      rec(v, k, nextStack);
    }
  };

  rec(root, null, []);
};

const isInMemberPropertyPosition = (stack: ReadonlyArray<WalkStackEntry>): boolean => {
  const self = stack[stack.length - 1]?.node;
  const parent = stack[stack.length - 2]?.node;

  if (!self || !parent || !isNodeRecord(parent as Node)) {
    return false;
  }

  const parentNode = parent as NodeLike;

  return parentNode.type === 'MemberExpression' && parentNode.property === self;
};

const isInTestPosition = (stack: ReadonlyArray<WalkStackEntry>): boolean => {
  for (let i = 0; i < stack.length - 1; i++) {
    const n = stack[i]?.node;
    const childKey = stack[i + 1]?.keyInParent;

    if (!n || !isNodeRecord(n as Node) || typeof childKey !== 'string') {
      continue;
    }

    const nodeRecord = n as NodeLike;

    if (
      (nodeRecord.type === 'IfStatement' && childKey === 'test') ||
      (nodeRecord.type === 'WhileStatement' && childKey === 'test') ||
      (nodeRecord.type === 'DoWhileStatement' && childKey === 'test') ||
      (nodeRecord.type === 'ForStatement' && childKey === 'test') ||
      (nodeRecord.type === 'ConditionalExpression' && childKey === 'test')
    ) {
      return true;
    }
  }

  return false;
};

const isInCallArguments = (stack: ReadonlyArray<WalkStackEntry>): boolean => {
  for (let i = stack.length - 2; i >= 0; i--) {
    const n = stack[i]?.node;
    const childKey = stack[i + 1]?.keyInParent;

    if (!n || !isNodeRecord(n as Node) || typeof childKey !== 'string') {
      continue;
    }

    if ((n as NodeLike).type === 'CallExpression' && childKey === 'arguments') {
      return true;
    }
  }

  return false;
};

const isInNewArguments = (stack: ReadonlyArray<WalkStackEntry>): boolean => {
  for (let i = stack.length - 2; i >= 0; i--) {
    const n = stack[i]?.node;
    const childKey = stack[i + 1]?.keyInParent;

    if (!n || !isNodeRecord(n as Node) || typeof childKey !== 'string') {
      continue;
    }

    if ((n as NodeLike).type === 'NewExpression' && childKey === 'arguments') {
      return true;
    }
  }

  return false;
};

const isInReturnArgument = (stack: ReadonlyArray<WalkStackEntry>): boolean => {
  for (let i = stack.length - 2; i >= 0; i--) {
    const n = stack[i]?.node;
    const childKey = stack[i + 1]?.keyInParent;

    if (!n || !isNodeRecord(n as Node) || typeof childKey !== 'string') {
      continue;
    }

    if ((n as NodeLike).type === 'ReturnStatement' && childKey === 'argument') {
      return true;
    }
  }

  return false;
};

const isInThrowArgument = (stack: ReadonlyArray<WalkStackEntry>): boolean => {
  for (let i = stack.length - 2; i >= 0; i--) {
    const n = stack[i]?.node;
    const childKey = stack[i + 1]?.keyInParent;

    if (!n || !isNodeRecord(n as Node) || typeof childKey !== 'string') {
      continue;
    }

    if ((n as NodeLike).type === 'ThrowStatement' && childKey === 'argument') {
      return true;
    }
  }

  return false;
};

const isInForwardingAssignment = (stack: ReadonlyArray<WalkStackEntry>): boolean => {
  for (let i = stack.length - 2; i >= 0; i--) {
    const n = stack[i]?.node;
    const childKey = stack[i + 1]?.keyInParent;

    if (!n || !isNodeRecord(n as Node) || typeof childKey !== 'string') {
      continue;
    }

    const nodeRecord = n as NodeLike;

    if (nodeRecord.type === 'VariableDeclarator' && childKey === 'init') {
      return true;
    }

    if (nodeRecord.type === 'AssignmentExpression' && childKey === 'right') {
      return true;
    }
  }

  return false;
};

const isInPropertyValue = (stack: ReadonlyArray<WalkStackEntry>): boolean => {
  for (let i = stack.length - 2; i >= 0; i--) {
    const n = stack[i]?.node;
    const childKey = stack[i + 1]?.keyInParent;

    if (!n || !isNodeRecord(n as Node) || typeof childKey !== 'string') {
      continue;
    }

    if ((n as NodeLike).type === 'Property' && childKey === 'value') {
      return true;
    }
  }

  return false;
};

const isInArrayElement = (stack: ReadonlyArray<WalkStackEntry>): boolean => {
  for (let i = stack.length - 2; i >= 0; i--) {
    const n = stack[i]?.node;
    const childKey = stack[i + 1]?.keyInParent;

    if (!n || !isNodeRecord(n as Node) || typeof childKey !== 'string') {
      continue;
    }

    if ((n as NodeLike).type === 'ArrayExpression' && childKey === 'elements') {
      return true;
    }
  }

  return false;
};

const isAllowedNarrowingContext = (stack: ReadonlyArray<WalkStackEntry>): boolean => {
  const self = stack[stack.length - 1]?.node;
  const parent = stack[stack.length - 2]?.node;

  if (!self || !parent || !isNodeRecord(parent as Node)) {
    return false;
  }

  const parentNode = parent as NodeLike;

  if (parentNode.type === 'UnaryExpression' && parentNode.operator === 'typeof') {
    return true;
  }

  if (parentNode.type === 'BinaryExpression') {
    const op = parentNode.operator;

    if (op === 'instanceof' && parentNode.left === self) {
      return true;
    }

    if (op === 'in' && parentNode.right === self) {
      return true;
    }

    if (op === '===' || op === '!==' || op === '==' || op === '!=') {
      const left = parentNode.left;
      const right = parentNode.right;
      const other = left === self ? right : right === self ? left : null;
      const otherNode = asNodeLike(other);

      if (
        otherNode &&
        ((otherNode.type === 'Literal' && otherNode.value === null) ||
          (otherNode.type === 'Identifier' && otherNode.name === 'undefined'))
      ) {
        return true;
      }
    }
  }

  // Allow calling guard functions in conditional test positions (e.g., Array.isArray(x), isFoo(x)).
  if (isInTestPosition(stack) && (isInCallArguments(stack) || isInNewArguments(stack))) {
    return true;
  }

  return false;
};

const collectBoundaryUnknownUsages = (input: CollectBoundaryUnknownUsagesInput): ReadonlyArray<BoundaryUsageCandidate> => {
  const declaredOffsets = new Set<number>(input.unknownBindings.map(b => b.offset));
  const unknownNames = new Set<string>(input.unknownBindings.map(b => b.name));
  const out: BoundaryUsageCandidate[] = [];

  if (unknownNames.size === 0) {
    return out;
  }

  walkOxcTreeWithStack(input.program, (node, stack) => {
    if (!isNodeRecord(node as Node)) {
      return;
    }

    const nodeRecord = node as NodeLike;

    if (nodeRecord.type !== 'Identifier') {
      return;
    }

    const name = typeof nodeRecord.name === 'string' ? nodeRecord.name : '';

    if (name.length === 0 || !unknownNames.has(name)) {
      return;
    }

    const startOffset = typeof nodeRecord.start === 'number' ? nodeRecord.start : 0;
    const endOffset = typeof nodeRecord.end === 'number' ? nodeRecord.end : startOffset;

    // Skip the declaration identifier itself.
    if (declaredOffsets.has(startOffset)) {
      return;
    }

    // Skip property name in member access: obj.prop (the `prop` identifier).
    if (isInMemberPropertyPosition(stack)) {
      return;
    }

    // Allow explicit narrowing contexts.
    if (isAllowedNarrowingContext(stack)) {
      return;
    }

    let usageKind: BoundaryUsageKind | null = null;

    if (isInReturnArgument(stack)) {
      usageKind = 'return';
    } else if (isInThrowArgument(stack)) {
      usageKind = 'throw';
    } else if (isInCallArguments(stack) || isInNewArguments(stack)) {
      usageKind = 'call';
    } else if (isInForwardingAssignment(stack)) {
      usageKind = 'assign';
    } else if (isInPropertyValue(stack) || isInArrayElement(stack)) {
      usageKind = 'store';
    }

    if (usageKind === null) {
      return;
    }

    out.push({
      name,
      offset: startOffset,
      span: toSpanFromOffsets(input.sourceText, startOffset, endOffset),
      usageKind,
    });
  });

  return out;
};

const collectUnknownProofCandidates = (input: CollectUnknownProofCandidatesInput): CollectUnknownProofCandidatesOutput => {
  const boundaryGlobs = (input.boundaryGlobs ?? []).map(p => normalizePath(p).trim()).filter(p => p.length > 0);
  const boundaryMatchers = compileGlobs(boundaryGlobs);
  const perFile = new Map<string, UnknownProofCandidates>();

  for (const file of input.program) {
    const filePath = file.filePath;
    const boundary = boundaryGlobs.length > 0 ? isBoundaryFile(input.rootAbs, filePath, boundaryMatchers) : false;
    const typeAssertionFindings: UnknownProofFinding[] = [];
    const nonBoundaryBindings: BindingCandidate[] = [];
    const boundaryUnknownUsages: BoundaryUsageCandidate[] = [];

    const unwrapAssertionInner = (value: unknown): NodeLike | null => {
      let current = asNodeLike(value);

      while (current && current.type === 'ParenthesizedExpression') {
        current = asNodeLike(current.expression);
      }

      return current;
    };

    const isConstAssertion = (value: NodeLike | null): boolean => {
      if (!value || value.type !== 'TSAsExpression') {
        return false;
      }

      const typeAnn = asNodeLike(value.typeAnnotation);

      if (!typeAnn || typeAnn.type !== 'TSTypeReference') {
        return false;
      }

      const typeName = asNodeLike(typeAnn.typeName);

      return !!(typeName && typeName.type === 'Identifier' && typeName.name === 'const');
    };

    const pushTypeAssertion = (kind: 'type-assertion' | 'double-assertion', node: unknown, message: string): void => {
      const nodeRecord = asNodeLike(node);
      const startOffset = typeof nodeRecord?.start === 'number' ? nodeRecord.start : 0;
      const endOffset = typeof nodeRecord?.end === 'number' ? nodeRecord.end : startOffset;
      const span = toSpanFromOffsets(file.sourceText, startOffset, endOffset);

      typeAssertionFindings.push({
        kind,
        message,
        filePath,
        span,
      });
    };

    walkOxcTree(file.program as Node, (node: Node) => {
      // satisfies only checks types and does not narrow; it is safe.
      if (node.type === 'TSSatisfiesExpression') {
        return true;
      }

      // Ban type assertions everywhere, except const assertions.
      if (node.type === 'TSAsExpression' || node.type === 'TSTypeAssertion') {
        if (node.type === 'TSAsExpression') {
          const record = isNodeRecord(node) ? (node as unknown as NodeLike) : null;
          const inner = record ? unwrapAssertionInner(record.expression) : null;

          if (inner && (inner.type === 'TSAsExpression' || inner.type === 'TSTypeAssertion') && !isConstAssertion(inner)) {
            pushTypeAssertion('double-assertion', node, 'Double type assertion bypasses type safety entirely');

            // Don't report the inner assertion too.
            return false;
          }

          const typeAnn = isNodeRecord(node) ? node.typeAnnotation : undefined;

          if (isNodeRecord(typeAnn) && typeAnn.type === 'TSTypeReference') {
            const typeName = typeAnn.typeName;

            if (isNodeRecord(typeName) && typeName.type === 'Identifier' && typeName.name === 'const') {
              return true;
            }
          }
        }

        pushTypeAssertion('type-assertion', node, 'Type assertions are forbidden (no `as T` / `<T>expr`)');

        return true;
      }

      if (!isNodeRecord(node)) {
        return true;
      }

      // Collect binding identifiers for tsgo proof checks.
      if (!boundary) {
        if (node.type === 'VariableDeclarator') {
          const ids = extractBindingIdentifiers(asNodeLike(node)?.id);

          for (const id of ids) {
            const name = typeof id?.name === 'string' ? id.name : '';

            if (name.length === 0) {
              continue;
            }

            const startOffset = typeof id.start === 'number' ? id.start : typeof node.start === 'number' ? node.start : 0;
            const endOffset = typeof id.end === 'number' ? id.end : startOffset;

            nonBoundaryBindings.push({
              name,
              offset: startOffset,
              span: toSpanFromOffsets(file.sourceText, startOffset, endOffset),
            });
          }
        }

        if (
          node.type === 'FunctionDeclaration' ||
          node.type === 'FunctionExpression' ||
          node.type === 'ArrowFunctionExpression'
        ) {
          const params = asNodeLike(node)?.params;

          if (Array.isArray(params)) {
            for (const p of params) {
              const ids = extractBindingIdentifiers(p);

              for (const id of ids) {
                const name = typeof id?.name === 'string' ? id.name : '';

                if (name.length === 0) {
                  continue;
                }

                const startOffset = typeof id.start === 'number' ? id.start : typeof node.start === 'number' ? node.start : 0;
                const endOffset = typeof id.end === 'number' ? id.end : startOffset;

                nonBoundaryBindings.push({
                  name,
                  offset: startOffset,
                  span: toSpanFromOffsets(file.sourceText, startOffset, endOffset),
                });
              }
            }
          }
        }
      }

      // unknown type annotations
      if (node.type === 'Identifier') {
        const id = asNodeLike(node);

        if (!id) {
          return true;
        }

        const name = typeof id.name === 'string' ? id.name : '';
        const typeAnn = id.typeAnnotation;

        if (!typeAnn || name.length === 0) {
          return true;
        }

        const hasUnknown = containsTsKeyword(typeAnn, 'TSUnknownKeyword');

        if (!hasUnknown) {
          return true;
        }

        const startOffset = typeof id.start === 'number' ? id.start : 0;
        const endOffset = typeof id.end === 'number' ? id.end : startOffset;
        const span = toSpanFromOffsets(file.sourceText, startOffset, endOffset);

        if (!boundary) {
          typeAssertionFindings.push({
            kind: 'unknown-type',
            message: 'Explicit `unknown` type is forbidden outside boundary files',
            filePath,
            span,
            symbol: name,
          });
        }
      }

      return true;
    });

    if (boundary) {
      const unknownBindings = collectUnknownAnnotatedBindings(file.program, file.sourceText);

      boundaryUnknownUsages.push(
        ...collectBoundaryUnknownUsages({
          program: file.program,
          sourceText: file.sourceText,
          unknownBindings,
        }),
      );
    }

    // De-dupe bindings by offset.
    const seenOffsets = new Set<number>();

    const dedupBindings = (items: ReadonlyArray<BindingCandidate>): BindingCandidate[] => {
      const out: BindingCandidate[] = [];

      for (const item of items) {
        if (seenOffsets.has(item.offset)) {
          continue;
        }

        seenOffsets.add(item.offset);
        out.push(item);
      }

      return out;
    };

    perFile.set(filePath, {
      typeAssertionFindings,
      nonBoundaryBindings: dedupBindings(nonBoundaryBindings),
      boundaryUnknownUsages,
    });
  }

  return { boundaryGlobs, perFile };
};

const stringifyHover = (hover: unknown): string => {
  if (!hover || typeof hover !== 'object') {
    return '';
  }

  const contents = asNodeLike(hover)?.contents;
  const raw = contents !== undefined ? contents : hover;

  const extract = (value: unknown): string[] => {
    if (value === null || value === undefined) {
      return [];
    }

    if (typeof value === 'string') {
      return [value];
    }

    if (Array.isArray(value)) {
      return value.flatMap(v => extract(v));
    }

    if (typeof value === 'object') {
      // MarkupContent: { kind: 'plaintext'|'markdown', value: string }
      const valueRecord = asNodeLike(value);

      if (typeof valueRecord?.value === 'string') {
        return [valueRecord.value];
      }

      // MarkedString: { language: string, value: string }
      if (typeof valueRecord?.language === 'string' && typeof valueRecord.value === 'string') {
        return [valueRecord.value];
      }
    }

    return [];
  };

  // LSP Hover.contents can be (string | MarkupContent | MarkedString | (string|MarkedString)[])
  const parts = extract(raw);

  if (parts.length > 0) {
    return parts.join('\n');
  }

  // Fallback for odd server shapes.
  return collectStringsFromNode(raw).join('\n');
};

export { collectUnknownProofCandidates, stringifyHover };
export type { UnknownProofCandidates };
