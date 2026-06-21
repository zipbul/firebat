// 문장 런 후보는 문장별로 동형(`$ID.add($ID); $ID.push($ID)`)이지만 문장 사이 동일참조가 다르다:
// add(value)/push(value)는 같은 바인딩 재사용, add(key)/push(item)은 서로 다른 바인딩.
// 런-정규형(런 전체 공유 rename 맵)이 어긋나므로 비보고(keep) — 거짓병합 방지.
function indexValue(set: Set<string>, list: string[], value: string): number {
  const start = list.length;
  set.add(value);
  list.push(value);
  return start;
}

function indexEntry(seen: Set<string>, out: string[], key: string, item: string): number {
  const start = out.length;
  seen.add(key);
  out.push(item);
  return start;
}
