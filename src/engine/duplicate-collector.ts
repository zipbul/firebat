import type { CloneDiff, DuplicateCloneType, DuplicateGroup, DuplicateItem, SourceSpan } from '../types';
import type { DuplicateFingerprintResolver, DuplicateItemKindResolver, OxcNodePredicate, ParsedFile } from './types';

import { collectOxcNodes, getNodeHeader, isNodeRecord, isOxcNode } from './ast/oxc-ast-utils';
import { countOxcSize } from './ast/oxc-size-count';
import { getLineColumn } from './source-position';

interface CollectorItem {
  readonly kind: DuplicateItem['kind'];
  readonly header: string;
  readonly filePath: string;
  readonly span: SourceSpan;
  readonly size: number;
  readonly node: unknown;
}

const computeCloneDiff = (leftNode: unknown, rightNode: unknown): CloneDiff | undefined => {
  const pairs: Array<{ left: string; right: string; location: string; kind: 'identifier' | 'literal' | 'type' }> = [];

  const walk = (left: unknown, right: unknown, location: string): void => {
    if (left === right) {
      return;
    }

    if (!isOxcNode(left) || !isOxcNode(right) || !isNodeRecord(left) || !isNodeRecord(right)) {
      return;
    }

    if (left.type !== right.type) {
      return;
    }

    if (
      left.type === 'Identifier' &&
      typeof (left as { name?: unknown }).name === 'string' &&
      typeof (right as { name?: unknown }).name === 'string'
    ) {
      const l = (left as { name: string }).name;
      const r = (right as { name: string }).name;

      if (l !== r) {
        pairs.push({ left: l, right: r, location, kind: 'identifier' });
      }

      return;
    }

    if (left.type === 'Literal') {
      const l = (left as { value?: unknown }).value;
      const r = (right as { value?: unknown }).value;

      if (
        l !== r &&
        (typeof l === 'string' || typeof l === 'number' || typeof l === 'boolean') &&
        (typeof r === 'string' || typeof r === 'number' || typeof r === 'boolean')
      ) {
        pairs.push({ left: String(l), right: String(r), location, kind: 'literal' });
      }

      return;
    }

    // Limited type-level diff signal.
    if (left.type === 'TSTypeReference') {
      const lName = (left as { typeName?: unknown }).typeName;
      const rName = (right as { typeName?: unknown }).typeName;

      if (
        isOxcNode(lName) &&
        isOxcNode(rName) &&
        isNodeRecord(lName) &&
        isNodeRecord(rName) &&
        lName.type === 'Identifier' &&
        rName.type === 'Identifier'
      ) {
        const l = (lName as { name?: unknown }).name;
        const r = (rName as { name?: unknown }).name;

        if (typeof l === 'string' && typeof r === 'string' && l !== r) {
          pairs.push({ left: l, right: r, location: `${location}.typeName`, kind: 'type' });
        }
      }
    }

    for (const [key, lValue] of Object.entries(left)) {
      if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') {
        continue;
      }

      const rValue = (right as Record<string, unknown>)[key];

      if (Array.isArray(lValue) && Array.isArray(rValue)) {
        const n = Math.min(lValue.length, rValue.length);

        for (let index = 0; index < n; index += 1) {
          walk(lValue[index], rValue[index], `${location}.${key}[${index}]`);
        }

        continue;
      }

      if (typeof lValue === 'object' && lValue !== null && typeof rValue === 'object' && rValue !== null) {
        walk(lValue, rValue, `${location}.${key}`);
      }
    }
  };

  walk(leftNode, rightNode, '');

  if (pairs.length === 0) {
    return undefined;
  }

  const kindPriority = (k: CloneDiff['kind']): number => (k === 'type' ? 3 : k === 'literal' ? 2 : 1);

  const kind = pairs.map(p => p.kind).sort((a, b) => kindPriority(b) - kindPriority(a))[0] as CloneDiff['kind'];

  return {
    kind,
    pairs: pairs.map(p => ({ left: p.left, right: p.right, location: p.location })),
  };
};

const collectDuplicateGroups = (
  files: ReadonlyArray<ParsedFile>,
  minSize: number,
  isTarget: OxcNodePredicate,
  resolveFingerprint: DuplicateFingerprintResolver,
  resolveKind: DuplicateItemKindResolver,
  cloneType: DuplicateCloneType,
): DuplicateGroup[] => {
  const groupsByHash = new Map<string, CollectorItem[]>();

  for (const file of files) {
    if (file.errors.length > 0) {
      continue;
    }

    const targets = collectOxcNodes(file.program, isTarget);

    for (const node of targets) {
      const size = countOxcSize(node);

      if (size < minSize) {
        continue;
      }

      const fingerprint = resolveFingerprint(node);
      const existing = groupsByHash.get(fingerprint) ?? [];
      const startOffset = node.start;
      const endOffset = node.end;
      const start = getLineColumn(file.sourceText, startOffset);
      const end = getLineColumn(file.sourceText, endOffset);

      existing.push({
        kind: resolveKind(node),
        header: getNodeHeader(node),
        filePath: file.filePath,
        span: {
          start,
          end,
        },
        size,
        node,
      });

      groupsByHash.set(fingerprint, existing);
    }
  }

  const groups: DuplicateGroup[] = [];

  for (const [, items] of groupsByHash.entries()) {
    if (items.length < 2) {
      continue;
    }

    const diff = computeCloneDiff(items[0]?.node, items[1]?.node);

    groups.push({
      cloneType,
      items: items.map(({ kind, header, filePath, span }) => ({ kind, header, filePath, span })),
      ...(diff ? { suggestedParams: diff } : {}),
    });
  }

  return groups.sort((left, right) => right.items.length - left.items.length);
};

export { collectDuplicateGroups };
