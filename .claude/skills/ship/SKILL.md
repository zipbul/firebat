---
name: ship
description: |
  커밋, PR 생성, 머지, 배포 시 사용.
  코드를 세상에 내보내는 단계.
disable-model-invocation: true
---

# 출시 (Ship)

검증된 코드를 커밋하고 PR을 만들어 머지하는 단계.

**`disable-model-invocation: true`** — 위험 작업이므로 `/ship`으로만 호출 가능.

## 절차

1. 검증 보고서를 `retrospector` 에이전트로 크로스 검증한다. "회고할 내용이 있는가?"
2. `release-engineer` 에이전트를 spawn하여 작업을 수행한다.
   - `git diff`, `git status`로 변경 사항 확인
   - conventional commit 형식으로 커밋 메시지 작성
   - `gh pr create`로 PR 생성
   - 사용자 승인 후 머지 실행
3. `ship-reviewer` 에이전트를 spawn하여 산출물을 검증한다.
   - conventional commit 형식 준수하는가
   - 불필요한 파일(*.log, .env 등)이 포함되지 않았는가
   - 모든 테스트가 통과하는가
   - lint/format 에러가 없는가
4. Critical/High 이슈가 있으면 수정 후 재리뷰한다.

## 산출물

- 머지된 PR (또는 머지 대기 PR)
