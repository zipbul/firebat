// K: 무인자 seed factory — `() => []`/`() => undefined`/`() => false`는 입력→출력
// 관계도 분기도 없는 thunk이고, 돌려주는 상수값의 반복은 redundancy(상수 추출) 영역이라
// duplicates의 결정-중복 대상이 아니다. 골격 규칙이 없으면 같은 본문끼리 묶일 쌍들이다.
const emptyListA: () => number[] = () => [];
const emptyListB: () => string[] = () => [];
const absentA: () => undefined = () => undefined;
const absentB: () => undefined = () => undefined;
const falseA: () => boolean = () => false;
const falseB: () => boolean = () => false;
