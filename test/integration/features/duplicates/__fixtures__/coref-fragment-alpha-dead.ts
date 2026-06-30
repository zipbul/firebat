// W — 두 함수의 문장 런이 동형이고 문장 사이 동일참조도 같다:
// 양쪽 모두 세 번째 파라미터를 add와 push에서 재사용(co-reference 보존).
// 런-정규형(런 전체 공유 rename 맵)이 일치 → 바인딩만 다른 클론으로 보고(W).
// coref-fragment-divergent-keep(K)의 W측 대칭.
function indexValue(set: Set<string>, list: string[], value: string): number {
  const start = list.length;
  set.add(value);
  list.push(value);
  return start;
}

function indexOther(bag: Set<string>, arr: string[], elem: string): number {
  const start = arr.length;
  bag.add(elem);
  arr.push(elem);
  return start;
}
