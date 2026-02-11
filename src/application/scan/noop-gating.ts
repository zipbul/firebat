type ExceptionHygieneStatus = 'ok' | 'unavailable' | 'failed';

interface NoopGatingInput {
  readonly exceptionHygieneSelected: boolean;
  readonly exceptionHygieneStatus?: ExceptionHygieneStatus;
}

const shouldIncludeNoopEmptyCatch = (input: NoopGatingInput): boolean => {
  if (!input.exceptionHygieneSelected) {
    return true;
  }

  return input.exceptionHygieneStatus !== 'ok';
};

export { shouldIncludeNoopEmptyCatch };
export type { ExceptionHygieneStatus };
