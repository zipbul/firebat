// Fixture: score threshold — wrapping-if with 1 statement (score=1) should NOT be reported
export function tiny(x: boolean) {
  if (x) {
    doA();
  }
}

function doA() {}
