// 타입파라미터 이름만 다르고 멤버 동일참조 구조가 같다({first:#0; second:#1}) → alpha-equivalent
// 계약 → 정규형 일치 → 보고(dead). 멤버 공유 rename 맵이 정상 계약 클론을 깨지 않음을 고정한다.
interface PairAB<T, U> {
  first: T;
  second: U;
}

interface PairPQ<P, Q> {
  first: P;
  second: Q;
}
