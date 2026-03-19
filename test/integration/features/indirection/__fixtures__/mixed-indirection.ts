// mixed-indirection: thin-wrapper + type-remap + interface-rewrap in one file
function wrapper(x: any) { return target(x); }
function target(x: any) { return x + 1; }

type Alias = Original;
interface Empty extends Base {}
