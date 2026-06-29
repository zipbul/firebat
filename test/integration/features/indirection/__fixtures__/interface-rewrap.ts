// interface-rewrap: empty interfaces that just extend.
// `export {}` makes this a module so same-name cross-file merging is excluded.
export {};

// W — empty body, exactly one non-generic extends, module file.
interface A extends B {}

// These should NOT be detected:
interface Multi extends B, C {} // multiple extends = composition (K)
interface WithMember extends B { x: number } // has members (K)
interface Marker {} // no extends, empty marker (K)
declare interface Ambient extends B {} // declare (K)
interface MergeTarget extends B {} // same-file declaration merging (K)
interface MergeTarget { x: number }
