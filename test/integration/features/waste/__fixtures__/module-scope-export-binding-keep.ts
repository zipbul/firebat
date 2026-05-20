// KEEP boundary: export된 binding은 CLAUDE.md "export된 binding (cross-module 분석 필요
// — dependencies detector 영역)" 비대상. value=1이 value=2로 덮이지만 export이므로 waste
// 분석에서 면제. (cross-module 사용 가능성을 detector가 알 수 없음.)

export let value = 1;
value = 2;
