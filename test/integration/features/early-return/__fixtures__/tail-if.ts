// Fixture: tail-if — last statement of function body is an if (no else) with preceding code
export function process(data: unknown) {
  const x = prepare(data);
  if (x > 0) {
    doA();
    doB();
    doC();
    doD();
  }
}

function prepare(_data: unknown): number {
  return 1;
}
function doA() {}
function doB() {}
function doC() {}
function doD() {}
