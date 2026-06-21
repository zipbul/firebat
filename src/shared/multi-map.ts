/**
 * key별 배열 버킷에 value를 추가. 버킷이 없으면 새로 만든다.
 * Map<K, V[]>를 multimap으로 쓰는 곳의 단일 변경지점.
 */
const pushToMultiMap = <K, V>(map: Map<K, V[]>, key: K, value: V): void => {
  const list = map.get(key);

  if (list === undefined) {
    map.set(key, [value]);
  } else {
    list.push(value);
  }
};

/**
 * key별 Set 버킷에 value를 추가. 버킷이 없으면 새로 만든다.
 * Map<K, Set<V>>를 multimap으로 쓰며 `get(k) ?? new Set; add; set`을 복제하던 곳의 단일 변경지점.
 */
const addToSetMap = <K, V>(map: Map<K, Set<V>>, key: K, value: V): void => {
  const set = map.get(key) ?? new Set<V>();

  set.add(value);
  map.set(key, set);
};

/**
 * key의 현재 값과 `value`를 `isBetter`로 비교해, 항목이 없거나 `value`가 더 나으면 갱신한다.
 * `const cur = map.get(k); if (cur === undefined || cmp) map.set(k, value)` (min/max 추적)을
 * 복제하던 곳의 단일 변경지점. min은 `(next, cur) => next < cur`, max는 `next > cur`를 넘긴다.
 */
const keepMapBound = <K, V>(map: Map<K, V>, key: K, value: V, isBetter: (next: V, current: V) => boolean): void => {
  const current = map.get(key);

  if (current === undefined || isBetter(value, current)) {
    map.set(key, value);
  }
};

export { addToSetMap, keepMapBound, pushToMultiMap };
