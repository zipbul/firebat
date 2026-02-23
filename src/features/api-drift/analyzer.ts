import type { Node } from 'oxc-parser';

import * as path from 'node:path';

import type { NodeValue, ParsedFile } from '../../engine/types';
import type { FirebatLogger } from '../../ports/logger';
import type { ApiDriftGroup, ApiDriftOutlier, ApiDriftShape, SourceSpan } from '../../types';

import {
  getLiteralString,
  getNodeName,
  isFunctionNode,
  isNodeRecord,
  isOxcNode,
  collectFunctionNodesWithParent,
  getNodeHeader,
  walkOxcTree,
} from '../../engine/ast/oxc-ast-utils';
import { getLineColumn } from '../../engine/source-position';
import { createNoopLogger } from '../../ports/logger';
import { runTsgoApiDriftChecks, type ApiDriftInterfaceMethodCandidate, type ApiDriftInterfaceToken } from './tsgo-checks';

const createEmptyApiDrift = (): ReadonlyArray<ApiDriftGroup> => [];

interface AnalyzeApiDriftInput {
  readonly rootAbs?: string;
  readonly tsconfigPath?: string;
  readonly logger?: FirebatLogger;
}

const isParamOptional = (value: NodeValue): boolean => {
  if (!isOxcNode(value)) {
    return false;
  }

  if (value.type === 'AssignmentPattern') {
    return true;
  }

  if (isNodeRecord(value) && typeof value.optional === 'boolean') {
    return value.optional;
  }

  return false;
};

const collectReturnStats = (node: NodeValue, rootNode: Node): readonly [boolean, boolean] => {
  let hasReturn = false;
  let hasReturnValue = false;

  walkOxcTree(node, value => {
    if (value !== rootNode && isFunctionNode(value)) {
      return false;
    }

    if (value.type === 'ReturnStatement' && isNodeRecord(value)) {
      hasReturn = true;

      if (value.argument != null) {
        hasReturnValue = true;
      }
    }

    return true;
  });

  return [hasReturn, hasReturnValue];
};

const buildShape = (node: Node): ApiDriftShape => {
  if (!isNodeRecord(node)) {
    return {
      paramsCount: 0,
      optionalCount: 0,
      returnKind: 'implicit-void',
      async: false,
    };
  }

  const params = Array.isArray(node.params) ? node.params : [];
  let optionalCount = 0;

  for (const param of params) {
    if (isParamOptional(param as NodeValue)) {
      optionalCount += 1;
    }
  }

  const asyncFlag = typeof node.async === 'boolean' ? node.async : false;
  let returnKind = 'implicit-void';
  const bodyValue = node.body as NodeValue | undefined;

  if (isOxcNode(bodyValue) && bodyValue.type !== 'BlockStatement') {
    returnKind = 'value';
  } else {
    const [hasReturn, hasReturnValue] = collectReturnStats(bodyValue, node);

    if (hasReturnValue) {
      returnKind = 'value';
    } else if (hasReturn) {
      returnKind = 'void';
    }
  }

  return {
    paramsCount: params.length,
    optionalCount,
    returnKind,
    async: asyncFlag,
  };
};

interface ShapeLocation {
  readonly filePath: string;
  readonly span: SourceSpan;
}

interface PrefixEntry {
  readonly prefix: string;
  readonly shape: ApiDriftShape;
  readonly location: ShapeLocation;
}

interface GroupAccumulator {
  readonly key: string;
  readonly label: string;
  readonly counts: Map<string, number>;
  readonly shapes: Map<string, ApiDriftShape>;
  readonly locations: Map<string, ShapeLocation>;
}

const recordShape = (
  groupsByKey: Map<string, GroupAccumulator>,
  groupKey: string,
  label: string,
  shape: ApiDriftShape,
  location: ShapeLocation,
): void => {
  const entry = groupsByKey.get(groupKey) ?? {
    key: groupKey,
    label,
    counts: new Map<string, number>(),
    shapes: new Map<string, ApiDriftShape>(),
    locations: new Map<string, ShapeLocation>(),
  };
  const shapeKey = JSON.stringify(shape);

  entry.counts.set(shapeKey, (entry.counts.get(shapeKey) ?? 0) + 1);
  entry.shapes.set(shapeKey, shape);
  entry.locations.set(shapeKey, location);

  groupsByKey.set(groupKey, entry);
};

const buildGroups = (groupsByKey: Map<string, GroupAccumulator>): ApiDriftGroup[] => {
  const groups: ApiDriftGroup[] = [];
  const keys = Array.from(groupsByKey.keys()).sort((left, right) => left.localeCompare(right));

  for (const key of keys) {
    const entry = groupsByKey.get(key);

    if (!entry || entry.counts.size <= 1) {
      continue;
    }

    let standardKey = '';
    let standardCount = -1;

    for (const [shapeKey, count] of entry.counts.entries()) {
      if (count > standardCount) {
        standardKey = shapeKey;
        standardCount = count;
      }
    }

    const standardShape = entry.shapes.get(standardKey);

    if (!standardShape) {
      continue;
    }

    const outliers: ApiDriftOutlier[] = [];

    for (const [shapeKey, shape] of entry.shapes.entries()) {
      if (shapeKey === standardKey) {
        continue;
      }

      const loc = entry.locations.get(shapeKey);

      outliers.push({
        shape,
        filePath: loc?.filePath ?? '',
        span: loc?.span ?? { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } },
      });
    }

    if (outliers.length === 0) {
      continue;
    }

    groups.push({ label: entry.label, standardCandidate: standardShape, outliers });
  }

  return groups;
};

const PREFIX_STOP_WORDS = new Set([
  'get', 'set', 'on', 'is', 'to', 'has', 'do', 'can', 'should', 'will',
  'add', 'remove', 'create', 'delete', 'update', 'find', 'handle', 'with',
  'process', 'validate', 'parse', 'build', 'render', 'compute', 'transform',
  'fetch', 'load', 'check', 'resolve', 'convert', 'format', 'serialize',
  'make', 'apply', 'init', 'run', 'map', 'filter', 'merge', 'submit',
  'dispatch', 'prepare', 'register', 'generate', 'configure', 'normalize',
  'extract', 'collect', 'emit', 'invoke', 'execute', 'compile', 'visit',
  'read', 'write', 'send', 'receive', 'open', 'close', 'start', 'stop',
  'show', 'hide', 'enable', 'disable', 'reset', 'clear', 'flush', 'sync',
  'patch', 'put', 'post', 'try', 'use', 'wrap', 'throw', 'log', 'print',
]);

const extractPrefixFamily = (name: string): string | null => {
  const trimmed = name.trim();

  if (trimmed.length === 0) {
    return null;
  }

  for (let index = 1; index < trimmed.length; index += 1) {
    const ch = trimmed[index];

    if (ch !== undefined && ch >= 'A' && ch <= 'Z') {
      const prefix = trimmed.slice(0, index);

      if (PREFIX_STOP_WORDS.has(prefix)) {
        return null;
      }

      return prefix;
    }
  }

  return trimmed;
};

const getClassName = (node: Node, parentMap: Map<Node, Node | null>): string | null => {
  let current: Node | null = node;

  while (current) {
    if ((current.type === 'ClassDeclaration' || current.type === 'ClassExpression') && isNodeRecord(current)) {
      const idName = getNodeName(current.id);

      if (typeof idName === 'string' && idName.trim().length > 0) {
        return idName;
      }

      if (current.type === 'ClassExpression') {
        const parent = parentMap.get(current);

        if (parent && isNodeRecord(parent) && parent.type === 'VariableDeclarator') {
          const varName = getNodeName(parent.id);

          if (typeof varName === 'string' && varName.trim().length > 0) {
            return varName;
          }
        }
      }
    }

    current = parentMap.get(current) ?? null;
  }

  return null;
};

const buildParentMap = (program: NodeValue): Map<Node, Node | null> => {
  const parentMap = new Map<Node, Node | null>();

  const visit = (value: NodeValue, parent: Node | null): void => {
    if (Array.isArray(value)) {
      for (const entry of value) {
        visit(entry as NodeValue, parent);
      }

      return;
    }

    if (!isOxcNode(value)) {
      return;
    }

    parentMap.set(value, parent);

    if (!isNodeRecord(value)) {
      return;
    }

    for (const [key, child] of Object.entries(value)) {
      if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') {
        continue;
      }

      visit(child as NodeValue, value);
    }
  };

  visit(program, null);

  return parentMap;
};

const collectInterfaceMethodCandidatesForFile = (file: ParsedFile): ReadonlyArray<ApiDriftInterfaceMethodCandidate> => {
  const candidates: ApiDriftInterfaceMethodCandidate[] = [];

  if (file.errors.length > 0) {
    return candidates;
  }

  walkOxcTree(file.program, node => {
    if (!isNodeRecord(node) || (node.type !== 'ClassDeclaration' && node.type !== 'ClassExpression')) {
      return true;
    }

    const implementsValue = node.implements;
    const implementsNodes = Array.isArray(implementsValue) ? implementsValue : [];

    if (implementsNodes.length === 0) {
      return true;
    }

    const interfaceTokens: ApiDriftInterfaceToken[] = [];

    for (const impl of implementsNodes) {
      if (!isOxcNode(impl) || !isNodeRecord(impl)) {
        continue;
      }

      const expr = impl.expression;

      if (!isOxcNode(expr)) {
        continue;
      }

      const name = getNodeName(expr as Node);

      if (typeof name !== 'string' || name.trim().length === 0) {
        continue;
      }

      const start = getLineColumn(file.sourceText, expr.start);
      const end = getLineColumn(file.sourceText, expr.end);

      interfaceTokens.push({ name, span: { start, end } });
    }

    if (interfaceTokens.length === 0) {
      return true;
    }

    const bodyValue = node.body;
    const bodyNodes = isOxcNode(bodyValue) && isNodeRecord(bodyValue) && Array.isArray(bodyValue.body) ? bodyValue.body : [];

    for (const element of bodyNodes) {
      if (!isOxcNode(element) || !isNodeRecord(element) || element.type !== 'MethodDefinition') {
        continue;
      }

      const methodKey = element.key;
      const methodName = methodKey != null ? (getLiteralString(methodKey) ?? getNodeName(methodKey)) : null;

      if (typeof methodName !== 'string' || methodName.trim().length === 0 || methodName === 'constructor') {
        continue;
      }

      const valueNode = element.value;

      if (!isOxcNode(valueNode)) {
        continue;
      }

      const shape = buildShape(valueNode);
      const start = getLineColumn(file.sourceText, element.start);
      const end = getLineColumn(file.sourceText, element.end);
      const span = { start, end };

      for (const interfaceToken of interfaceTokens) {
        candidates.push({
          interfaceToken,
          methodName,
          shape,
          filePath: file.filePath,
          span,
        });
      }
    }

    return true;
  });

  return candidates;
};

const analyzeApiDrift = async (
  files: ReadonlyArray<ParsedFile>,
  input?: AnalyzeApiDriftInput,
): Promise<ReadonlyArray<ApiDriftGroup>> => {
  if (files.length === 0) {
    return createEmptyApiDrift();
  }

  const groupsByKey = new Map<string, GroupAccumulator>();
  const prefixCounts = new Map<string, number>();
  const prefixEntries: PrefixEntry[] = [];
  const interfaceCandidatesByFile = new Map<string, ReadonlyArray<ApiDriftInterfaceMethodCandidate>>();

  for (const file of files) {
    if (file.errors.length > 0) {
      continue;
    }

    const parentMap = buildParentMap(file.program);
    const functions = collectFunctionNodesWithParent(file.program);
    const fileLabelSuffix = path.basename(file.filePath);

    for (const fn of functions) {
      const name = getNodeHeader(fn.node, fn.parent);

      if (name === 'anonymous' || name.trim().length === 0) {
        continue;
      }

      const shape = buildShape(fn.node);
      const start = getLineColumn(file.sourceText, fn.node.start);
      const end = getLineColumn(file.sourceText, fn.node.end);
      const location: ShapeLocation = { filePath: file.filePath, span: { start, end } };

      if (fn.parent && isNodeRecord(fn.parent) && fn.parent.type === 'MethodDefinition') {
        const className = getClassName(fn.parent, parentMap);

        if (className !== null && className.trim().length > 0) {
          recordShape(groupsByKey, `class:${className}.${name}`, `${className}.${name}`, shape, location);
        }

        continue;
      }

      recordShape(groupsByKey, `file:${file.filePath}:${name}`, `${name} @ ${fileLabelSuffix}`, shape, location);

      const prefix = extractPrefixFamily(name);

      if (prefix !== null && prefix.length > 0) {
        prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
        prefixEntries.push({ prefix, shape, location });
      }
    }

    const interfaceCandidates = collectInterfaceMethodCandidatesForFile(file);

    if (interfaceCandidates.length > 0) {
      interfaceCandidatesByFile.set(file.filePath, interfaceCandidates);
    }
  }

  const qualifiedPrefixes = new Set<string>();

  for (const [prefix, count] of prefixCounts.entries()) {
    if (count >= 3) {
      qualifiedPrefixes.add(prefix);
    }
  }

  for (const entry of prefixEntries) {
    if (!qualifiedPrefixes.has(entry.prefix)) {
      continue;
    }

    recordShape(groupsByKey, `prefix:${entry.prefix}`, `prefix:${entry.prefix}`, entry.shape, entry.location);
  }

  const rootAbs = input?.rootAbs;
  const logger = input?.logger ?? createNoopLogger();
  let interfaceGroups: ReadonlyArray<ApiDriftGroup> = [];

  if (rootAbs !== undefined && interfaceCandidatesByFile.size > 0) {
    const tsgoResult = await runTsgoApiDriftChecks({
      program: files,
      candidatesByFile: interfaceCandidatesByFile,
      rootAbs,
      ...(input?.tsconfigPath !== undefined ? { tsconfigPath: input.tsconfigPath } : {}),
      logger,
    });

    if (tsgoResult.ok) {
      interfaceGroups = tsgoResult.groups;
    } else {
      logger.warn('api-drift: tsgo type-check failed — interface drift analysis skipped');
    }
  }

  return [...buildGroups(groupsByKey), ...interfaceGroups];
};

export { analyzeApiDrift, createEmptyApiDrift };
