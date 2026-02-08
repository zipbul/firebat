// Rich fixture for analysis tools: scan, find_pattern, lint
// Contains intentional patterns for various detectors.

export const hello = () => {
  console.log('hello');

  return 123;
};

// Intentional duplicate of hello (exact-duplicates detector)
export const hello2 = () => {
  console.log('hello');

  return 123;
};

export function add(a: number, b: number): number {
  return a + b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}

export class Calculator {
  value: number = 0;

  add(n: number): this {
    this.value += n;

    return this;
  }

  subtract(n: number): this {
    this.value -= n;

    return this;
  }

  multiply(n: number): this {
    this.value *= n;

    return this;
  }

  reset(): void {
    this.value = 0;
  }

  getResult(): number {
    return this.value;
  }
}

export interface Shape {
  area(): number;
  perimeter(): number;
}

export type Point = { x: number; y: number };

export type Rectangle = { topLeft: Point; bottomRight: Point };

export enum Color {
  Red = 'red',
  Green = 'green',
  Blue = 'blue',
}

export enum Direction {
  Up,
  Down,
  Left,
  Right,
}

// Waste: dead store
const unused = 42;

void unused;

// Nesting: deeply nested
export function deepNest(a: boolean, b: boolean, c: boolean): string {
  if (a) {
    if (b) {
      if (c) {
        return 'abc';
      }

      return 'ab';
    }

    return 'a';
  }

  return 'none';
}

// Early return candidate
export function earlyReturnCandidate(x: number): string {
  if (x > 0) {
    if (x > 10) {
      return 'big';
    }
      return 'small';
    
  }
    return 'negative';
  
}

// Noop block
export function withNoop(flag: boolean): void {
  if (flag) {
    // intentionally empty
  }
}

// Multiple console.log for find_pattern
export function logMany(): void {
  console.log('one');
  console.log('two');
  console.log('three');
  console.error('not a log');
}
