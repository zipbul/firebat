// KEEP boundary (분석 대상 외): class field는 CLAUDE.md 비대상.
// 'name'은 use 0회처럼 보이지만 detector는 class field 자체를 분석 대상에서 제외.
// (ORM/DI 등 framework가 reflection으로 read하는 일반 패턴 대표.)

export class UserEntity {
  name: string = '';

  setName(value: string): void {
    this.name = value;
  }
}
