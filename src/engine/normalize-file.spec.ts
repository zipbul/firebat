import { describe, expect, it } from 'bun:test';

import { normalizeFile } from './normalize-file';

describe('normalizeFile', () => {
  // HP-1: Unix 절대경로 + /src/ 있음 → src/... 반환
  it('should return src-relative path when /src/ segment exists in Unix absolute path', () => {
    expect(normalizeFile('/home/revil/projects/firebat/src/features/foo.ts')).toBe('src/features/foo.ts');
  });

  // HP-2: Windows 절대경로 + /src/ 있음 → 역슬래시 정규화 후 src/... 반환
  it('should normalize backslashes and return src-relative path for Windows path with /src/', () => {
    expect(normalizeFile('C:\\Users\\user\\project\\src\\features\\bar.ts')).toBe('src/features/bar.ts');
  });

  // HP-3: 이미 상대경로 src/... → 그대로 반환
  it('should return already-relative src path unchanged', () => {
    expect(normalizeFile('src/features/foo.ts')).toBe('src/features/foo.ts');
  });

  // HP-4: 루트 레벨 절대경로 (/src/ 없음) → basename 반환
  it('should return basename when path has no /src/ segment and is an absolute Unix path', () => {
    expect(normalizeFile('/home/revil/projects/firebat/index.ts')).toBe('index.ts');
  });

  // HP-5: Windows 루트 레벨 절대경로 → basename 반환
  it('should return basename when Windows path has no /src/ segment', () => {
    expect(normalizeFile('C:\\Users\\user\\project\\drizzle.config.ts')).toBe('drizzle.config.ts');
  });

  // NE-1: 빈 문자열 → 빈 문자열 반환
  it('should return empty string when input is empty string', () => {
    expect(normalizeFile('')).toBe('');
  });

  // NE-2: 슬래시 없는 순수 파일명 → 그대로 반환
  it('should return the filename unchanged when input has no slashes', () => {
    expect(normalizeFile('foo.ts')).toBe('foo.ts');
  });

  // ED-1: 정확히 /src/ 경로 → src/ 반환
  it('should return src/ when path is exactly /src/', () => {
    expect(normalizeFile('/src/')).toBe('src/');
  });

  // ED-2: /src/가 두 번 등장 → lastIndexOf 기준 마지막 src/...
  it('should use lastIndexOf so nested /src/ returns the last one', () => {
    expect(normalizeFile('/a/src/b/src/c.ts')).toBe('src/c.ts');
  });

  // CO-1: Windows + /src/ 없음 + 절대경로 → basename 반환
  it('should return basename for Windows absolute path without /src/ segment', () => {
    expect(normalizeFile('C:\\project\\oxlint-plugin.ts')).toBe('oxlint-plugin.ts');
  });

  // ID-1: 동일 입력 2회 호출 → 동일 결과
  it('should return the same result when called twice with the same input', () => {
    const input = '/home/revil/projects/firebat/src/engine/types.ts';
    expect(normalizeFile(input)).toBe(normalizeFile(input));
  });
});
