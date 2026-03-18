// TODO: gildash 0.8.1+ 배포 후 `import type { ResolvedType, SemanticReference } from '@zipbul/gildash'`로 전환
// 현재 0.8.0 dist에 미반영 — 로컬 정의로 임시 대체

export interface ResolvedType {
  text: string;
  flags: number;
  isUnion: boolean;
  isIntersection: boolean;
  isGeneric: boolean;
  members?: ResolvedType[];
  typeArguments?: ResolvedType[];
}

export interface SemanticReference {
  filePath: string;
  position: number;
  line: number;
  column: number;
  isDefinition: boolean;
  isWrite: boolean;
}
