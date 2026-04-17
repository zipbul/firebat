#!/bin/bash
# post-global-review.sh — global-reviewer 실행 후 bash 후처리
#
# 1. claude stdin에서 <verdict> 블록 추출
# 2. PASS인 경우: global-review-pass 마커 생성 확인 (없으면 생성)
# 3. FAIL인 경우: affected_plans 되돌림 (reviewed-pass → draft, feedback 저장, 마커 제거)
#
# Usage: post-global-review.sh < <claude_output>

set -euo pipefail
export LC_ALL=C.UTF-8

ROOT=".firebat"
PLAN="$ROOT/plan"
MARKER="$PLAN/global-review-pass"
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

INPUT=$(cat)

VERDICT=$(printf '%s' "$INPUT" | bash "$SKILL_DIR/scripts/extract-verdict.sh" verdict 2>/dev/null) || {
  echo "post-global-review: no verdict found in output" >&2
  exit 0
}

RESULT=$(echo "$VERDICT" | jq -r '.result // "UNKNOWN"')

echo "post-global-review: result=$RESULT" >&2

if [[ "$RESULT" == "PASS" ]]; then
  # marker가 없으면 생성 (agent가 안 만들었어도 bash가 보장)
  if [[ ! -f "$MARKER" ]]; then
    ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    printf 'reviewed_at: %s\nresult: PASS\n' "$ts" > "$MARKER"
    echo "post-global-review: created marker" >&2
  fi
  exit 0
fi

# FAIL: affected_plans 되돌림
rm -f "$MARKER"

AFFECTED_COUNT=$(echo "$VERDICT" | jq -r '.affected_plans | length // 0')
echo "post-global-review: reverting $AFFECTED_COUNT plan(s)" >&2

echo "$VERDICT" | jq -c '.affected_plans // [] | .[]' | while IFS= read -r entry; do
  [[ -z "$entry" ]] && continue
  PLAN_PATH=$(echo "$entry" | jq -r '.plan_file // ""')
  [[ -z "$PLAN_PATH" ]] && continue
  [[ ! -f "$PLAN_PATH" ]] && continue

  SLUG=$(basename "$PLAN_PATH" .md | sed -E 's/^[0-9]+-//')

  sed -i -E 's/^status: reviewed-pass$/status: draft/' "$PLAN_PATH"

  # feedback 저장 (planner가 다음 iter에서 소비)
  echo "$entry" | jq '[.]' > "$PLAN/$SLUG.feedback.json"

  echo "post-global-review: reverted $SLUG" >&2
done

exit 0
