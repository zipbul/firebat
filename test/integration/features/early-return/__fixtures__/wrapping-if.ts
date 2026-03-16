// Fixture: wrapping-if — function body entirely wrapped in a single if (no else)
export function process(data: unknown) {
  if (isValid(data)) {
    doA();
    doB();
    doC();
    doD();
    doE();
  }
}

function isValid(_data: unknown): boolean {
  return true;
}

function doA() {}

function doB() {}

function doC() {}

function doD() {}

function doE() {}
