// Fixture: loop body wrapping-if — loop body's last statement is an if (no else)
export function processAll(items: string[]) {
  for (const item of items) {
    if (item.length > 0) {
      doA(item);
      doB(item);
      doC(item);
      doD(item);
      doE(item);
      doF(item);
    }
  }
}

function doA(_s: string) {}
function doB(_s: string) {}
function doC(_s: string) {}
function doD(_s: string) {}
function doE(_s: string) {}
function doF(_s: string) {}
