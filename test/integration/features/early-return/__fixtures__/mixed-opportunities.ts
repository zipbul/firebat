// Fixture: mixed opportunities — wrapping-if + invertible coexist in same function
export function mixed(a: boolean, b: string | null): string {
  if (b === null) {
    return 'none';
  } else {
    const x = b.trim();
    const y = x.toUpperCase();
    const z = y + '!';

    return z;
  }
}

// wrapping-if only
export function wrapOnly(data: unknown) {
  if (data !== null) {
    doA();
    doB();
    doC();
  }
}

function doA() {}

function doB() {}

function doC() {}
