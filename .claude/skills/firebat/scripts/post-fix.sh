#!/bin/bash
# post-fix.sh — fixer 실행 후 bash 후처리
#
# 1. claude stdout(stdin으로 받음)에서 <execution-summary> 추출
# 2. .firebat/last-fix-summary.json 저장 (다음 iter maybe_rescan이 참조)
# 3. directory_status == "complete"이면 index.md에 [x] 마킹
# 4. blocked_findings가 있으면 state.json log에 기록
#
# Usage: post-fix.sh <SLUG> < <claude_output>

set -euo pipefail
export LC_ALL=C.UTF-8

SLUG="${1:?usage: post-fix.sh <SLUG> < <claude_output>}"

ROOT=".firebat"
STATE="$ROOT/state.json"
INDEX="$ROOT/plan/index.md"
SUMMARY_FILE="$ROOT/last-fix-summary.json"
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# stdin 전체를 버퍼링 (extract-verdict 호출 1회만 가능하게)
INPUT=$(cat)

# <execution-summary> 블록 추출
SUMMARY=$(printf '%s' "$INPUT" | bash "$SKILL_DIR/scripts/extract-verdict.sh" execution-summary 2>/dev/null) || {
  echo "post-fix: no execution-summary found in fixer output" >&2
  # 빈 summary로 기록 (다음 rescan skip 유도 — 실제로 수정이 있었을 수도 있지만 안전)
  echo '{"files_modified":[],"directory_status":"unknown","blocked_findings":[]}' > "$SUMMARY_FILE"
  exit 0
}

echo "$SUMMARY" > "$SUMMARY_FILE"

STATUS=$(echo "$SUMMARY" | jq -r '.directory_status // "unknown"')
BLOCKED_COUNT=$(echo "$SUMMARY" | jq -r '.blocked_findings | length // 0')
MOD_COUNT=$(echo "$SUMMARY" | jq -r '.files_modified | length // 0')

echo "post-fix: $SLUG status=$STATUS files_modified=$MOD_COUNT blocked=$BLOCKED_COUNT" >&2

# directory_status == complete → index.md 체크
if [[ "$STATUS" == "complete" ]] && [[ -f "$INDEX" ]]; then
  sed -i -E "s/^- \[ \] ${SLUG}\$/- [x] ${SLUG}/" "$INDEX"
fi

# blocked_findings 기록
if [[ "$BLOCKED_COUNT" != "0" ]] && [[ -f "$STATE" ]]; then
  BLOCKED_MSG=$(echo "$SUMMARY" | jq -r --arg slug "$SLUG" '
    [.blocked_findings[] | "[\($slug)] " + .id + ": " + .reason] | join(" | ")
  ')
  jq --arg msg "$BLOCKED_MSG" --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '.log += [{ts:$ts, msg:$msg}]' "$STATE" > /tmp/_state.$$.json && mv /tmp/_state.$$.json "$STATE"
fi

exit 0
