// K: 두 화살표는 모두 항등(`x => x`) — 파라미터를 그대로 반환하는 no-op 변환 골격이다.
// 정규형이 같아도 결정(분기·계산·호출)을 담지 않으므로 클론으로 보고 금지.
// (리터럴 비치환·minSize 1 골든에서 — 골격 규칙이 없으면 한 그룹으로 묶일 쌍이다.)
const identityA: (value: number) => number = value => value;
const identityB: (token: string) => string = token => token;
