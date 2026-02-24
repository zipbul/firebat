// primitive-skip: primitive type variables should NOT trigger memory-retention

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
