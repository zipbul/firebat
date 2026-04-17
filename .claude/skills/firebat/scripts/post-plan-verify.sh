#!/bin/bash
# post-plan-verify.sh — planner 실행 후 bash가 수행하는 후처리
#
# 역할:
#   1. verify-plan.sh 실행
#   2. PASS: status → reviewed-pass, index.md 업데이트, feedback 삭제, fail_log 리셋
#   3. FAIL: feedback 저장, fail_log 증가
#   4. verdict JSON을 stdout으로 출력 (orchestrator가 참조 가능)
#
# Usage: post-plan-verify.sh <PLAN_FILE> <DIR_SLUG>

set -euo pipefail
export LC_ALL=C.UTF-8

PLAN_FILE="${1:?usage: post-plan-verify.sh <PLAN_FILE> <DIR_SLUG>}"
SLUG="${2:?usage: post-plan-verify.sh <PLAN_FILE> <DIR_SLUG>}"

ROOT=".firebat"
STATE="$ROOT/state.json"
INDEX="$ROOT/plan/index.md"
FEEDBACK="$ROOT/plan/$SLUG.feedback.json"
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -f "$PLAN_FILE" ]]; then
  jq -n --arg slug "$SLUG" '{result:"FAIL", reason:"plan_file_missing", slug:$slug}'
  exit 0
fi

# verify-plan.sh exits 1 on FAIL — still outputs valid verdict JSON.
# Capture output regardless of exit code; rely on result field, not exit code.
VERDICT=$(bash "$SKILL_DIR/scripts/verify-plan.sh" "$PLAN_FILE" "$SLUG" || true)
if [[ -z "$VERDICT" ]] || ! echo "$VERDICT" | jq . >/dev/null 2>&1; then
  # verify-plan.sh 자체가 깨진 경우
  jq -n --arg slug "$SLUG" '{result:"FAIL", reason:"verify-plan crashed or emitted invalid JSON", slug:$slug, feedback_for_planner:[{check_id:"internal",issue:"verify-plan.sh internal error",required_change:"re-run after fixing infrastructure"}]}'
  exit 0
fi
RESULT=$(echo "$VERDICT" | jq -r '.result // "FAIL"')

if [[ "$RESULT" == "PASS" ]]; then
  sed -i -E 's/^status: draft$/status: reviewed-pass/' "$PLAN_FILE"

  [[ -f "$INDEX" ]] || printf -- '---\nphase: PLANNING\n---\n\n# Directory Plan Index\n\n' > "$INDEX"
  grep -qF "- [ ] $SLUG" "$INDEX" || grep -qF "- [x] $SLUG" "$INDEX" || echo "- [ ] $SLUG" >> "$INDEX"
  rm -f "$FEEDBACK"

  if [[ -f "$STATE" ]]; then
    jq --arg s "$SLUG" '.fail_log[$s] = 0' "$STATE" > /tmp/_state.$$.json && mv /tmp/_state.$$.json "$STATE"
  fi
else
  echo "$VERDICT" | jq '.feedback_for_planner' > "$FEEDBACK"

  if [[ -f "$STATE" ]]; then
    jq --arg s "$SLUG" '.fail_log[$s] = ((.fail_log[$s] // 0) + 1)' "$STATE" > /tmp/_state.$$.json && mv /tmp/_state.$$.json "$STATE"
  fi
fi

echo "$VERDICT"
