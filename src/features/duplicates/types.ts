/**
 * duplicates 피처 내부 타입.
 *
 * InternalCloneItem/InternalCloneGroup은 Level 1~2 파이프라인에서 AST Node를 보존한다.
 * 최종 출력 시 node를 drop하여 DuplicateItem/DuplicateGroup으로 변환.
 */

import type { Node } from 'oxc-parser';

import type { DuplicateCloneType, DuplicateFindingKind, FirebatItemKind, SourceSpan } from '../../types';

/**
 * 내부 처리용 클론 아이템.
 * AST Node를 보존하여 Level 2 anti-unification에서 사용.
 */
export interface InternalCloneItem {
  readonly node: Node;
  readonly kind: FirebatItemKind;
  readonly header: string;
  readonly filePath: string;
  readonly span: SourceSpan;
  readonly size: number;
}

/**
 * 내부 처리용 클론 그룹.
 * Level 1 → InternalCloneGroup[] 형태로 수집
 * Level 2 → node를 이용해 antiUnify 수행
 * 최종 출력 → node drop → DuplicateGroup[]
 */
export interface InternalCloneGroup {
  readonly cloneType: DuplicateCloneType;
  readonly findingKind?: DuplicateFindingKind;
  readonly items: ReadonlyArray<InternalCloneItem>;
}
