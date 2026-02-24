// empty-body-noop: empty function body, intentional noop skip,
//   MemberExpression self-assignment, falsy constant condition

export function emptyBody(): void {}

export function _noop(): void {}

export const noop = (): void => {};

export class Widget {
  value = 0;

  reset(): void {
    this.value = this.value;
  }
}

export function falsyCondition(x: number): number {
  if (0) {
    return -1;
  }

  return x;
}
