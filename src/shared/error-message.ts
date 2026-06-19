const toErrorMessage = (err: unknown): string => {
  return err instanceof Error ? err.message : String(err);
};

const failWithMessage = (message: string): never => {
  throw new Error(message);
};

export { failWithMessage, toErrorMessage };
