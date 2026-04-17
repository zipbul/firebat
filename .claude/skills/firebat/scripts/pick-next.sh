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
STATE="$ROOT/state.json"

if [[ ! -f "$TREE" ]]; then
  echo '{"action":"none","reason":"tree.json missing"}'
  exit 0
fi

is_blocked() {
  local slug="$1"
  [[ -f "$STATE" ]] || return 1
  jq -e --arg s "$slug" '.blocked // {} | has($s)' "$STATE" >/dev/null 2>&1
}

case "$PHASE" in
  planning)
    # glob-safe plan file lookup: nullglob 켜진 상태에서 ls에 glob 전달 시
    # 매치 실패면 ls가 인자 없이 실행되어 cwd를 나열함 → glob array로 명시적 체크.
    find_plan_file() {
      local slug="$1"
      local candidates=("$ROOT"/plan/[0-9][0-9]-"$slug".md)
      if [[ ${#candidates[@]} -gt 0 && -e "${candidates[0]}" ]]; then
        printf '%s' "${candidates[0]}"
      fi
    }

    # 다음 plan 대상 slug 찾기: depth DESC, dir ASC. blocked slug는 건너뜀.
    SLUG=""
    while IFS= read -r s; do
      [[ -z "$s" ]] && continue
      if is_blocked "$s"; then
        continue  # blocked slug는 무한 재선택 방지
      fi
      PLAN=$(find_plan_file "$s")
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
      EXISTING=$(find_plan_file "$SLUG")
      if [[ -n "$EXISTING" ]]; then
        PLAN_FILE="$EXISTING"
      else
        all_plans=("$ROOT"/plan/[0-9][0-9]-*.md)
        COUNT=${#all_plans[@]}
        # nullglob: 매치 없으면 빈 배열. 그래도 ${#arr[@]}은 0 반환.
        if [[ $COUNT -gt 0 && ! -e "${all_plans[0]}" ]]; then
          COUNT=0
        fi
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
    # unchecked 디렉토리 순회, blocked/plan-missing 건너뜀
    SLUG=""
    PLAN_FILE=""
    while IFS= read -r entry; do
      [[ -z "$entry" ]] && continue
      s=$(echo "$entry" | awk '{print $3}')
      if is_blocked "$s"; then
        continue
      fi
      candidates=("$ROOT"/plan/[0-9][0-9]-"$s".md)
      if [[ ${#candidates[@]} -gt 0 && -e "${candidates[0]}" ]]; then
        SLUG="$s"
        PLAN_FILE="${candidates[0]}"
        break
      fi
    done < <(grep -E '^- \[ \] ' "$INDEX" 2>/dev/null || true)

    if [[ -z "$SLUG" ]]; then
      echo '{"action":"none","reason":"no actionable unchecked dirs"}'
      exit 0
    fi

    DIR=$(jq -r --arg s "$SLUG" '.[] | select(.slug == $s) | .dir' "$TREE")

    jq -n --arg action fix --arg slug "$SLUG" --arg dir "$DIR" --arg plan_file "$PLAN_FILE" \
      '{action:$action, slug:$slug, dir:$dir, plan_file:$plan_file}'
    ;;

  *)
    echo "pick-next: unknown phase '$PHASE' (expected: planning|executing)" >&2
    exit 1
    ;;
esac
