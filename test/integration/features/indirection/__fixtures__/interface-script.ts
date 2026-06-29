// script file (no top-level import/export) — same-name interfaces can merge
// across files, so a single-file AST cannot close it → all interface-rewrap K.
interface A extends B {}
interface C extends D {}

declare const a: A;
declare const c: C;
