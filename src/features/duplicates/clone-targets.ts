/**
 * Clone 탐지 대상 노드 유형 및 공유 유틸리티.
 *
 * analyzer.ts와 near-miss-detector.ts가 공통으로 사용하는 순수 함수들.
 */

import type { Node } from 'oxc-parser';

import type { FirebatItemKind, SourceSpan } from '../../types';

import { buildLineOffsets, getLineColumn } from '@zipbul/gildash';

export const CLONE_TARGET_TYPES = new Set([
  'FunctionDeclaration',
  'ClassDeclaration',
  'ClassExpression',
  'MethodDefinition',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'TSTypeAliasDeclaration',
  'TSInterfaceDeclaration',
]);

export const isCloneTarget = (node: Node): boolean => CLONE_TARGET_TYPES.has(node.type);

export const getItemKind = (node: Node): FirebatItemKind => {
  const t = node.type;

  if (t === 'FunctionDeclaration' || t === 'FunctionExpression' || t === 'ArrowFunctionExpression') {return 'function';}

  if (t === 'MethodDefinition') {return 'method';}

  if (t === 'ClassDeclaration' || t === 'ClassExpression' || t === 'TSTypeAliasDeclaration') {return 'type';}

  if (t === 'TSInterfaceDeclaration') {return 'interface';}

  return 'node';
};

export const resolveSpan = (sourceText: string, node: Node): SourceSpan => {
  const offsets = buildLineOffsets(sourceText);

  return {
    start: getLineColumn(offsets, node.start),
    end: getLineColumn(offsets, node.end),
  };
};
