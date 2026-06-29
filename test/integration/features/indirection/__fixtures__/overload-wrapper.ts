// overload: an overloaded function's implementation forwards, but overload
// signatures provide narrowing → K (suppressed by overload index).
export function greet(name: string): string;
export function greet(name: string, age: number): string;
export function greet(name: string, age?: number): string {
  return format(name, age);
}

function format(name: string, age?: number): string {
  return age === undefined ? name : `${name}:${age}`;
}

greet('x');
