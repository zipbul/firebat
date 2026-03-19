// interface-rewrap: empty interfaces that just extend
interface A extends B {}
interface Multi extends B, C {}

// These should NOT be detected:
interface WithMember extends B { x: number }
interface Marker {}
declare interface Ambient extends B {}
interface MergeTarget extends B {}
interface MergeTarget { x: number }
