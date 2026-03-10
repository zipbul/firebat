// primitive-skip: primitive type variables (number, string, boolean) should NOT trigger dead-store findings
// Dead-store detection targets assigned-but-never-read variables; primitives that are read before scope exit are valid.

export function primitiveLifetime(): number {
  const count: number = 42;
  const label: string = 'hello';
  const flag: boolean = true;

  console.log('step 1');
  console.log('step 2');
  console.log('step 3');
  console.log('step 4');
  console.log('step 5');
  console.log('step 6');
  console.log('step 7');
  console.log('step 8');
  console.log('step 9');
  console.log('step 10');
  console.log('step 11');
  console.log('step 12');

  return count + label.length + (flag ? 1 : 0);
}
