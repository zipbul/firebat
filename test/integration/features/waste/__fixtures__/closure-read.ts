// KEEP boundary (case 1·5의 반례): 변수가 inner closure에서 read됨
// 'counter = 0' def는 lambda의 'counter += 1'과 'return counter'에서 read됨 → USED.
// detector가 closure escape를 use로 인식하면 자동 KEEP.

export function makeCounter(): () => number {
  let counter = 0;

  return () => {
    counter += 1;

    return counter;
  };
}
