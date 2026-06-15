interface ToolFailureInput {
  readonly tool: string;
  readonly exitCode: number;
  readonly stderr: string;
  /**
   * 비정상 종료(exitCode !== 0)일 때 "예상된 비정상 종료"와 "도구 실패"를 가르는 신호.
   * 도구가 의미 있는 출력을 내지 못했으면 true(= 실패로 본다).
   */
  readonly hasNoMeaningfulOutput: boolean;
}

interface ToolFailureResult {
  /** 도구가 실제로 실패했는가 (예상된 비정상 종료가 아니라). */
  readonly looksLikeFailure: boolean;
  /** stderr 첫 줄, 없으면 종료 코드 요약. */
  readonly summary: string;
}

/**
 * 외부 도구의 비정상 종료가 "예상된 findings 때문"인지 "실제 실패"인지 판정하고,
 * 실패 요약 문자열을 만든다. oxfmt/oxlint 러너가 공유하는 단일 변경지점.
 */
const detectToolFailure = (input: ToolFailureInput): ToolFailureResult => {
  const { tool, exitCode, stderr, hasNoMeaningfulOutput } = input;
  const looksLikeFailure = exitCode !== 0 && hasNoMeaningfulOutput;
  const trimmedStderr = stderr.trim();
  // length > 0 이면 split 결과 첫 원소는 항상 string. fallback은 도달 불가지만 non-null 단언 회피용.
  const firstStderrLine = trimmedStderr.split('\n')[0] ?? trimmedStderr;
  const summary = trimmedStderr.length > 0 ? firstStderrLine : `${tool} exited with code ${exitCode}`;

  return { looksLikeFailure, summary };
};

export { detectToolFailure };
