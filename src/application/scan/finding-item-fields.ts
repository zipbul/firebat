interface FileLikeItem {
  readonly file?: unknown;
  readonly filePath?: unknown;
}

/**
 * Finding/diagnostic item에서 파일 경로 문자열을 뽑는 단일 결정.
 * `file`을 우선하고 없으면 `filePath`, 문자열이 아니면 빈 문자열.
 * scan/flatten/aggregate 경로가 공유하는 "item의 파일 경로" 변경지점.
 */
const itemFileString = (item: FileLikeItem | null | undefined): string => {
  const value = item?.file ?? item?.filePath;

  return typeof value === 'string' ? value : '';
};

export { itemFileString };
