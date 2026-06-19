// K: 멤버 이름·타입은 같아도 판별 리터럴(kind)이 다르다 → 다른 계약(판별 union).
// 계약 멤버 비교에서 리터럴을 치환하면 서로 다른 노드 종류가 충돌(FP).
interface ArrayNode {
  kind: 'array';
  items: number;
}

interface StringNode {
  kind: 'string';
  items: number;
}
