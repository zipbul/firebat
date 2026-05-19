// KEEP boundary (case 6·7의 반례): 변수가 return으로 escape됨
// 'list'는 push만 일어나지만 return으로 caller에게 전달 → caller가 관찰 가능.

export function build(): string[] {
  const list: string[] = [];

  list.push('x');

  return list;
}
