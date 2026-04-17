#!/bin/bash
# pick-next.sh — 다음에 무엇을 할지 결정 (라우팅 로직을 bash로 이관)
#
# Usage:
#   pick-next.sh planning   → Phase 1 다음 action 반환
#   pick-next.sh executing  → Phase 2 다음 action 반환
#
# Output: JSON
#   { action: "plan"|"global-review"|"none", slug, dir, plan_file, feedback_file }  (planning)
#   { action: "fix"|"none",                slug, dir, plan_file }                  (executing)

set -euo pipefail
shopt -s nullglob
export LC_ALL=C.UTF-8

PHASE="${1:-}"
ROOT=".firebat"
TREE="$ROOT/tree.json"
INDEX="$ROOT/plan/index.md"

if [[ ! -f "$TREE" ]]; then
  echo '{"action":"none","reason":"tree.json missing"}'
  exit 0
fi

case "$PHASE" in
  planning)
    # 다음 plan 대상 slug 찾기: depth DESC, dir ASC 순서로 draft/review-failed/없음 찾음
    SLUG=""
    while IFS= read -r s; do
      [[ -z "$s" ]] && continue
      PLAN=$(ls "$ROOT"/plan/[0-9][0-9]-"$s".md 2>/dev/null | head -1 || true)
      if [[ -z "$PLAN" ]]; then
        SLUG="$s"
        break
      fi
      STATUS=$(awk '/^---$/{f=!f; next} f && /^status:/{print $2; exit}' "$PLAN")
      if [[ "$STATUS" == "draft" || "$STATUS" == "review-failed" ]]; then
        SLUG="$s"
        break
      fi
    done < <(jq -r '.[].slug' "$TREE")

    if [[ -n "$SLUG" ]]; then
      # plan 대상 있음
      EXISTING=$(ls "$ROOT"/plan/[0-9][0-9]-"$SLUG".md 2>/dev/null | head -1 || true)
      if [[ -n "$EXISTING" ]]; then
        PLAN_FILE="$EXISTING"
      else
        COUNT=$(ls "$ROOT"/plan/[0-9][0-9]-*.md 2>/dev/null | wc -l | tr -d ' ')
        NN=$(printf "%02d" $((COUNT + 1)))
        PLAN_FILE="$ROOT/plan/$NN-$SLUG.md"
      fi

      DIR=$(jq -r --arg s "$SLUG" '.[] | select(.slug == $s) | .dir' "$TREE")
      FEEDBACK="$ROOT/plan/$SLUG.feedback.json"
      [[ -f "$FEEDBACK" ]] || FEEDBACK=""

      jq -n --arg action plan --arg slug "$SLUG" --arg dir "$DIR" \
        --arg plan_file "$PLAN_FILE" --arg feedback_file "$FEEDBACK" \
        '{action:$action, slug:$slug, dir:$dir, plan_file:$plan_file, feedback_file:$feedback_file}'
      exit 0
    fi

    # plan 대상 없음 + global-review-pass 없음 → global review
    if [[ ! -f "$ROOT/plan/global-review-pass" ]]; then
      echo '{"action":"global-review"}'
      exit 0
    fi

    # plan 전부 완료 + global-review 통과 → nothing (orchestrator가 phase 전환)
    echo '{"action":"none","reason":"phase 1 complete"}'
    ;;

  executing)
    # 첫 번째 unchecked 디렉토리 찾기
    ENTRY=$(grep -E '^- \[ \] ' "$INDEX" 2>/dev/null | head -1 || true)
    if [[ -z "$ENTRY" ]]; then
      echo '{"action":"none","reason":"all dirs checked"}'
      exit 0
    fi

    SLUG=$(echo "$ENTRY" | awk '{print $3}')
    PLAN_FILE=$(ls "$ROOT"/plan/[0-9][0-9]-"$SLUG".md 2>/dev/null | head -1 || true)
    DIR=$(jq -r --arg s "$SLUG" '.[] | select(.slug == $s) | .dir' "$TREE")

    jq -n --arg action fix --arg slug "$SLUG" --arg dir "$DIR" --arg plan_file "$PLAN_FILE" \
      '{action:$action, slug:$slug, dir:$dir, plan_file:$plan_file}'
    ;;

  *)
    echo "pick-next: unknown phase '$PHASE' (expected: planning|executing)" >&2
    exit 1
    ;;
esac
