// 계약 멤버 사이 타입파라미터 동일참조가 다르다: {first:T; second:T}(같은 T 재사용) vs
// {first:T; second:U}(서로 다른 타입파라미터). 멤버 공유 rename 맵으로 정규형이 어긋남 → keep.
interface SameTypePair<T, U> {
  first: T;
  second: T;
}

interface MixedTypePair<T, U> {
  first: T;
  second: U;
}
