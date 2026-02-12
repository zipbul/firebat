import type { Node } from 'oxc-parser';

import type { DuplicateCloneType, DuplicateGroup, DuplicateItem } from '../types';
import type { ParsedFile } from './types';

import { collectDuplicateGroups } from './duplicate-collector';
import { getNodeType } from './oxc-ast-utils';
import { createOxcFingerprint, createOxcFingerprintExact, createOxcFingerprintNormalized, createOxcFingerprintShape } from './oxc-fingerprint';

const isCloneTarget = (node: Node): boolean => {
  const type = getNodeType(node);

  return (
    type === 'FunctionDeclaration' ||
    type === 'ClassDeclaration' ||
    type === 'ClassExpression' ||
    type === 'MethodDefinition' ||
    type === 'FunctionExpression' ||
    type === 'ArrowFunctionExpression' ||
    type === 'TSTypeAliasDeclaration' ||
    type === 'TSInterfaceDeclaration'
  );
};

const getItemKind = (node: Node): DuplicateItem['kind'] => {
  const nodeType = getNodeType(node);

  if (nodeType === 'FunctionDeclaration' || nodeType === 'FunctionExpression' || nodeType === 'ArrowFunctionExpression') {
    return 'function';
  }

  if (nodeType === 'MethodDefinition') {
    return 'method';
  }

  if (nodeType === 'ClassDeclaration' || nodeType === 'ClassExpression' || nodeType === 'TSTypeAliasDeclaration') {
    return 'type';
  }

  if (nodeType === 'TSInterfaceDeclaration') {
    return 'interface';
  }

  return 'node';
};

const resolveFingerprint = (cloneType: DuplicateCloneType) => {
  if (cloneType === 'type-1') {
    return createOxcFingerprintExact;
  }

  if (cloneType === 'type-2') {
    return createOxcFingerprint;
  }

  if (cloneType === 'type-3-normalized') {
    return createOxcFingerprintNormalized;
  }

  return createOxcFingerprintShape;
};

export const detectClones = (files: ReadonlyArray<ParsedFile>, minSize: number, cloneType: DuplicateCloneType): DuplicateGroup[] => {
  return collectDuplicateGroups(files, minSize, isCloneTarget, resolveFingerprint(cloneType), getItemKind, cloneType);
};

export { isCloneTarget };
