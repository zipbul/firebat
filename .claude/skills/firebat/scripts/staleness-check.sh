#!/bin/bash
# staleness-check.sh — Phase 2 진입 시 새 findings 감지
#
# 현재 by-dir의 primary finding ID 중 plan에 없는 것(= fix가 도입한 새 finding)이 있으면:
#   1. 해당 finding이 속한 dir의 plan을 status: draft로 되돌림
#   2. index.md에서 [x] → [ ]로 전환
#   3. global-review-pass 마커 제거
#   4. exit 1 (orchestrator가 phase를 PLANNING으로 회귀시킴)
#
# 새 finding 없으면 exit 0 (phase 유지).
#
# Usage: staleness-check.sh
#   Output on stderr: 진단 메시지. stdout: 회귀된 slug 리스트 (line-separated) or empty.

set -euo pipefail
shopt -s nullglob
export LC_ALL=C.UTF-8

ROOT=".firebat"
PLAN="$ROOT/plan"
INDEX="$PLAN/index.md"
BY_DIR="$ROOT/by-dir"

if [[ ! -d "$BY_DIR" ]]; then
  echo "staleness-check: by-dir missing — cannot verify" >&2
  exit 0  # 첫 iter인 경우
fi

# 현재 primary finding IDs (glob-safe)
_bdf=("$BY_DIR"/*.json)
if [[ ${#_bdf[@]} -eq 0 || ! -e "${_bdf[0]}" ]]; then
  exit 0  # by-dir 비어있음
fi
CURRENT=$(jq -r '.findings[] | select(.primary) | .id' "${_bdf[@]}" 2>/dev/null | sort -u)

if [[ -z "$CURRENT" ]]; then
  exit 0  # findings 없음 → staleness 없음
fi

# plan 파일에 등장하는 모든 finding ID (토큰 경계 매칭)
# nullglob이므로 매치 없으면 배열 빈 상태 → grep stdin hang 방지 위해 파일 존재 확인
plan_files=("$PLAN"/[0-9][0-9]-*.md)
if [[ ${#plan_files[@]} -gt 0 ]]; then
  PLANNED=$(grep -hoE '[a-z-]+-[0-9a-f]{12}' "${plan_files[@]}" 2>/dev/null | sort -u || true)
else
  PLANNED=""
fi

# CURRENT에 있고 PLANNED에 없는 = 새 finding
NEW_IDS=$(comm -23 <(echo "$CURRENT") <(echo "$PLANNED"))

if [[ -z "$NEW_IDS" ]]; then
  exit 0  # 정상
fi

echo "staleness-check: $(echo "$NEW_IDS" | wc -l | tr -d ' ') new finding(s) detected" >&2

# 각 new finding이 속한 dir의 plan을 찾아 draft로 되돌림
AFFECTED_SLUGS=$(
  for fid in $NEW_IDS; do
    # 어떤 by-dir에 이 finding이 있는지 찾기
    for bd in "$BY_DIR"/*.json; do
      if jq -e --arg id "$fid" '.findings | any(.id == $id)' "$bd" >/dev/null 2>&1; then
        basename "$bd" .json
        break
      fi
    done
  done | sort -u
)

for slug in $AFFECTED_SLUGS; do
  # glob-safe lookup
  _cand=("$PLAN"/[0-9][0-9]-"$slug".md)
  if [[ ${#_cand[@]} -gt 0 && -e "${_cand[0]}" ]]; then
    plan_file="${_cand[0]}"
  else
    plan_file=""
  fi
  if [[ -n "$plan_file" ]]; then
    # reviewed-pass → draft, [x] → [ ]
    sed -i -E 's/^status: reviewed-pass$/status: draft/' "$plan_file"
    if [[ -f "$INDEX" ]]; then
      sed -i -E "s/^- \[x\] ${slug}\$/- [ ] ${slug}/" "$INDEX"
    fi
    echo "$slug"
    echo "staleness-check: regressed $slug to draft" >&2
  fi
done

# global-review-pass 마커 제거 (새 plan이 필요하므로)
rm -f "$PLAN/global-review-pass"

exit 1
