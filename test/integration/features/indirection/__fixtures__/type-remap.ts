// type-remap: mix of detectable remaps and legitimate aliases
type A = B;
export type Alias = Original;
type Node = ts.Node;

// These should NOT be detected:
type UserId = string;
type StringArray = Array<string>;
type ReadonlyUser = Readonly<User>;
type MyArray<T> = Array<T>;
type Union = B | null;
type Intersection = B & { x: 1 };
declare type Ambient = B;
