// case 7 at module-scope: `state` has only property writes, no real read or escape.

const state = { count: 0 };
state.count = 42;
