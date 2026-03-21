// Fixture: invertible boundary — shortCount=3/4, ratio 2x boundary values
// Case 1: shortCount=3, longCount=6 — exactly 2x, should detect
export function exactBoundary(x: boolean): string {
  if (x) {
    const a = 'short1';
    const b = 'short2';
    return a + b;
  } else {
    const c = 'long1';
    const d = 'long2';
    const e = 'long3';
    const f = 'long4';
    const g = 'long5';
    return c + d + e + f + g;
  }
}

// Case 2: shortCount=4, should NOT detect (over limit)
export function overLimit(x: boolean): string {
  if (x) {
    const a = 'a';
    const b = 'b';
    const c = 'c';
    return a + b + c;
  } else {
    const d = 'd';
    const e = 'e';
    const f = 'f';
    const g = 'g';
    const h = 'h';
    const i = 'i';
    const j = 'j';
    return d + e + f + g + h + i + j;
  }
}

// Case 3: shortCount=3, longCount=5 — below 2x, should NOT detect invertible
export function belowRatio(x: boolean): string {
  if (x) {
    const a = 'short1';
    const b = 'short2';
    return a + b;
  } else {
    const c = 'long1';
    const d = 'long2';
    const e = 'long3';
    const f = 'long4';
    return c + d + e + f;
  }
}
