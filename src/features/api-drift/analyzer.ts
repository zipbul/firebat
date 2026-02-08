import type { Node } from 'oxc-parser';

import type { NodeValue, ParsedFile } from '../../engine/types';
import type { ApiDriftAnalysis, ApiDriftGroup, ApiDriftOutlier, ApiDriftShape, SourceSpan } from '../../types';

import {
  collectFunctionNodes,
  getLiteralString,
  getNodeName,
  isFunctionNode,
  isNodeRecord,
  isOxcNode,
  walkOxcTree,
} from '../../engine/oxc-ast-utils';
import { getLineColumn } from '../../engine/source-position';

const createEmptyApiDrift = (): ApiDriftAnalysis => ({
  groups: [],
});

const getFunctionName = (node: Node): string | null => {
  const idNode = isNodeRecord(node) ? node.id : undefined;
  const idName = getNodeName(idNode);

  if (typeof idName === 'string' && idName.length > 0) {
    return idName;
  }

  const key = isNodeRecord(node) ? node.key : undefined;

  if (key !== undefined && key !== null) {
    const keyName = getNodeName(key);

    if (typeof keyName === 'string' && keyName.length > 0) {
      return keyName;
    }

    const keyValue = getLiteralString(key);

    if (typeof keyValue === 'string' && keyValue.length > 0) {
      return keyValue;
    }
  }

  return null;
};

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

  const bodyValue = node.body as NodeValue | undefined;
  const [hasReturn, hasReturnValue] = collectReturnStats(bodyValue, node);
  const asyncFlag = typeof node.async === 'boolean' ? node.async : false;
  let returnKind = 'implicit-void';

  if (hasReturnValue) {
    returnKind = 'value';
  } else if (hasReturn) {
    returnKind = 'void';
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

const recordShape = (
  name: string,
  shape: ApiDriftShape,
  location: ShapeLocation,
  countsByName: Map<string, Map<string, number>>,
  shapesByName: Map<string, Map<string, ApiDriftShape>>,
  locationsByName: Map<string, Map<string, ShapeLocation>>,
): void => {
  const key = JSON.stringify(shape);
  const countMap = countsByName.get(name) ?? new Map<string, number>();
  const shapeMap = shapesByName.get(name) ?? new Map<string, ApiDriftShape>();
  const locMap = locationsByName.get(name) ?? new Map<string, ShapeLocation>();

  countMap.set(key, (countMap.get(key) ?? 0) + 1);
  shapeMap.set(key, shape);
  locMap.set(key, location);

  countsByName.set(name, countMap);
  shapesByName.set(name, shapeMap);
  locationsByName.set(name, locMap);
};

const buildGroups = (
  countsByName: Map<string, Map<string, number>>,
  shapesByName: Map<string, Map<string, ApiDriftShape>>,
  locationsByName: Map<string, Map<string, ShapeLocation>>,
): ApiDriftGroup[] => {
  const groups: ApiDriftGroup[] = [];
  const names = Array.from(countsByName.keys()).sort((left, right) => left.localeCompare(right));

  for (const name of names) {
    const countMap = countsByName.get(name);
    const shapeMap = shapesByName.get(name);
    const locMap = locationsByName.get(name);

    if (!countMap || !shapeMap || !locMap || countMap.size <= 1) {
      continue;
    }

    let standardKey = '';
    let standardCount = -1;

    for (const [key, count] of countMap.entries()) {
      if (count > standardCount) {
        standardKey = key;
        standardCount = count;
      }
    }

    const standardShape = shapeMap.get(standardKey);

    if (!standardShape) {
      continue;
    }

    const outliers: ApiDriftOutlier[] = [];

    for (const [key, shape] of shapeMap.entries()) {
      if (key === standardKey) {
        continue;
      }

      const loc = locMap.get(key);

      outliers.push({
        shape,
        filePath: loc?.filePath ?? '',
        span: loc?.span ?? { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } },
      });
    }

    if (outliers.length === 0) {
      continue;
    }

    groups.push({
      label: name,
      standardCandidate: standardShape,
      outliers,
    });
  }

  return groups;
};

const analyzeApiDrift = (files: ReadonlyArray<ParsedFile>): ApiDriftAnalysis => {
  if (files.length === 0) {
    return createEmptyApiDrift();
  }

  const countsByName = new Map<string, Map<string, number>>();
  const shapesByName = new Map<string, Map<string, ApiDriftShape>>();
  const locationsByName = new Map<string, Map<string, ShapeLocation>>();

  for (const file of files) {
    if (file.errors.length > 0) {
      continue;
    }

    const functions = collectFunctionNodes(file.program);

    for (const functionNode of functions) {
      const name = getFunctionName(functionNode);

      if (name === null || name.length === 0) {
        continue;
      }

      const shape = buildShape(functionNode);
      const start = getLineColumn(file.sourceText, functionNode.start);
      const end = getLineColumn(file.sourceText, functionNode.end);
      const location: ShapeLocation = {
        filePath: file.filePath,
        span: { start, end },
      };

      recordShape(name, shape, location, countsByName, shapesByName, locationsByName);
    }
  }

  return {
    groups: buildGroups(countsByName, shapesByName, locationsByName),
  };
};

export { analyzeApiDrift, createEmptyApiDrift };
