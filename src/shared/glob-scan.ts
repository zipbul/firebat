import * as path from 'node:path';

/**
 * 여러 glob 패턴을 cwd 기준으로 스캔해 매치된 상대경로를 cwd 기준 절대경로로 모은다.
 * "패턴마다 Bun.Glob으로 파일만(심볼릭링크 미추적) 스캔 → path.resolve(cwd, rel) 수집"이라는
 * 단일 결정의 변경지점. 패턴→glob 인자 변환은 toGlobArg로 주입한다(기본: 항등).
 * 중복 제거·정렬·필터는 호출자가 담당한다(수집 결과를 그대로 돌려준다).
 */
const scanGlobsToAbsolutePaths = async (
  patterns: ReadonlyArray<string>,
  cwd: string,
  toGlobArg: (pattern: string) => string = pattern => pattern,
): Promise<string[]> => {
  const out: string[] = [];

  for (const pattern of patterns) {
    const glob = new Bun.Glob(toGlobArg(pattern));

    for await (const rel of glob.scan({ cwd, onlyFiles: true, followSymlinks: false })) {
      out.push(path.resolve(cwd, rel));
    }
  }

  return out;
};

export { scanGlobsToAbsolutePaths };
