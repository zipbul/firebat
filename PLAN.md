기능 추가

디렉토리 구조 검사 규칙 추가할수있음?
진입부 first unknown 이후 무조건 Type Definition

에이전트 룰 추가

*.types.ts
*.interfaces.ts
*.constants.ts
*.enums.ts
types.ts
interfaces.ts
constants.ts
enums.ts

한 파일 내 코드 섞지 말것
function 끼리
type 끼리
interface 끼리
constant 끼리
enum 끼리
class = 1 파일 1 클래스


에이전트는 프로젝트 내 파일 변경 작업 후엔 반드시 bun firebat 실행