// throw-non-error: throw literal, throw primitive wrapper, async-promise-executor

export function throwString(): never {
  throw 'something went wrong';
}

export function throwNumber(): never {
  throw 42;
}

export function throwPrimitiveWrapper(): never {
  throw String('error message');
}

export function asyncPromiseExecutor(): Promise<string> {
  return new Promise(async (resolve) => {
    const result = await Promise.resolve('data');
    resolve(result);
  });
}
