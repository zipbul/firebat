#!/bin/bash
# plan-complete.sh — Phase 1 plan 완성도 객관 검증
#
# Exit 0 = 통과, Exit 1 = 미완료. stderr에 구체적 사유.

set -euo pipefail
shopt -s nullglob
export LC_ALL=C.UTF-8

ROOT=".firebat"
TREE="$ROOT/tree.json"
BY_DIR="$ROOT/by-dir"
PLAN="$ROOT/plan"
STATE="$ROOT/state.json"

is_blocked() {
  local slug="$1"
  [[ -f "$STATE" ]] || return 1
  jq -e --arg s "$slug" '.blocked // {} | has($s)' "$STATE" >/dev/null 2>&1
}

if [[ ! -f "$TREE" ]]; then
  echo "plan-complete: $TREE missing — run scan-split first" >&2
  exit 1
fi
if [[ ! -d "$PLAN" ]]; then
  echo "plan-complete: $PLAN directory missing — planning not started" >&2
  exit 1
fi

FAILED=0
declare -a FAIL_REASONS=()

# tree.json에서 slug 목록 (빈 배열 처리)
mapfile -t SLUGS < <(jq -r '.[].slug' "$TREE")
if [[ ${#SLUGS[@]} -eq 0 ]]; then
  echo "plan-complete: no directories in tree.json — nothing to plan" >&2
  exit 0  # 0 findings = 완료
fi

# 1) 모든 디렉토리에 plan 파일 존재
for slug in "${SLUGS[@]}"; do
  found=("$PLAN"/[0-9][0-9]-"$slug".md)
  if [[ ${#found[@]} -eq 0 ]]; then
    FAIL_REASONS+=("missing plan for dir: $slug")
    FAILED=1
  fi
done

# 2) 각 plan 파일의 status: reviewed-pass (blocked slug은 review-failed 허용)
for plan_file in "$PLAN"/[0-9][0-9]-*.md; do
  # slug 추출
  plan_slug=$(basename "$plan_file" .md | sed -E 's/^[0-9]+-//')
  plan_status=$(awk '/^---$/{f=!f; next} f && /^status:/{print $2; exit}' "$plan_file")
  if [[ "$plan_status" == "reviewed-pass" ]]; then
    continue
  fi
  if is_blocked "$plan_slug"; then
    continue  # blocked slug은 review-failed 상태라도 PASS 판정
  fi
  FAIL_REASONS+=("not reviewed-pass: $(basename "$plan_file")")
  FAILED=1
done

# 3) 각 plan의 primary finding id가 본문에 정확히 등장 (토큰 경계)
for slug in "${SLUGS[@]}"; do
  # blocked slug은 체크 생략
  if is_blocked "$slug"; then
    continue
  fi
  plan_matches=("$PLAN"/[0-9][0-9]-"$slug".md)
  [[ ${#plan_matches[@]} -eq 0 ]] && continue
  plan_file="${plan_matches[0]}"
  by_dir_file="$BY_DIR/$slug.json"
  [[ ! -f "$by_dir_file" ]] && continue

  # primary finding ID 목록
  mapfile -t primary_ids < <(jq -r '.findings[] | select(.primary) | .id' "$by_dir_file")

  missing_count=0
  declare -a missing_list=()
  for fid in "${primary_ids[@]}"; do
    # 토큰 경계로 정확 매칭 (waste-1이 waste-10에 매칭되는 문제 방지)
    if ! grep -qE "(^|[^[:alnum:]-])${fid}([^[:alnum:]-]|$)" "$plan_file"; then
      missing_list+=("$fid")
      missing_count=$((missing_count + 1))
    fi
  done
  if [[ $missing_count -gt 0 ]]; then
    FAIL_REASONS+=("$slug: $missing_count finding ids missing from plan (e.g., ${missing_list[0]:-})")
    FAILED=1
  fi
  unset missing_list
done

# 4) plan/index.md 존재 + 모든 slug 포함
if [[ ! -f "$PLAN/index.md" ]]; then
  FAIL_REASONS+=("plan/index.md missing")
  FAILED=1
else
  for slug in "${SLUGS[@]}"; do
    if ! grep -qF "$slug" "$PLAN/index.md"; then
      FAIL_REASONS+=("index.md missing entry: $slug")
      FAILED=1
    fi
  done
fi

# 5) global-review-pass 마커
if [[ ! -f "$PLAN/global-review-pass" ]]; then
  FAIL_REASONS+=("global-review-pass marker missing — run firebat-global-reviewer")
  FAILED=1
fi

if [[ $FAILED -eq 1 ]]; then
  echo "plan-complete: INCOMPLETE (${#FAIL_REASONS[@]} issues)" >&2
  printf '  - %s\n' "${FAIL_REASONS[@]}" >&2
  exit 1
fi

echo "plan-complete: PASS — all ${#SLUGS[@]} directories reviewed" >&2
exit 0
