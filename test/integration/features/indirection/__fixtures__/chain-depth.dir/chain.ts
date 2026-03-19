// chain-depth: 3-level intra-file forwarding chain
import { target } from './target';

export function level1(x: number): number {
  return level2(x);
}

function level2(x: number): number {
  return level3(x);
}

function level3(x: number): number {
  return target(x);
}
