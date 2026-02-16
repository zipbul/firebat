export class PartialResultError<T> extends Error {
  public readonly partial: ReadonlyArray<T>;

  public constructor(message: string, partial: ReadonlyArray<T>) {
    super(message);
    this.name = 'PartialResultError';
    this.partial = partial;
  }
}
