// Fixture: cascade-guard in loop — else-if chain with continue/break exits
export function processItems(items: Array<{ type: string; value: string }>) {
  for (const item of items) {
    if (item.type === 'skip') {
      continue;
    } else if (item.type === 'done') {
      break;
    } else {
      doA(item);
      doB(item);
      doC(item);
      doD(item);
      doE(item);
    }
  }
}

function doA(_item: unknown) {}

function doB(_item: unknown) {}

function doC(_item: unknown) {}

function doD(_item: unknown) {}

function doE(_item: unknown) {}
