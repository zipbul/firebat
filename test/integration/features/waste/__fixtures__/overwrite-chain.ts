// case 1: 할당 후 read 전에 덮임
// 'value = 1', 'value = 2'는 read 없이 다음 def가 덮음. 'value = 3'만 read됨.

export function overwriteChain(): number {
  let value = 1;
  value = 2;
  value = 3;

  return value;
}
