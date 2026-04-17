#!/bin/bash
# extract-reference.sh — firebat reference 파일에서 특정 code의 섹션만 추출
#
# 사용법: extract-reference.sh <category> <code>
#   category: waste, barrel, dependencies 등
#   code: WASTE_DEAD_STORE 같은 구체 코드
#
# Anthropic "smallest high-signal tokens" 원칙 — 전체 reference 파일 대신
# 해당 code의 섹션만 추출해서 fixer에게 전달.

set -euo pipefail

CATEGORY="${1:-}"
CODE="${2:-}"

if [[ -z "$CATEGORY" || -z "$CODE" ]]; then
  echo "usage: extract-reference.sh <category> <code>" >&2
  exit 1
fi

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REF_FILE="$SKILL_DIR/references/$CATEGORY.md"

# lint/format/typecheck은 external-tools.md 공용
case "$CATEGORY" in
  lint|format|typecheck)
    REF_FILE="$SKILL_DIR/references/external-tools.md"
    ;;
esac

if [[ ! -f "$REF_FILE" ]]; then
  echo "extract-reference: $REF_FILE not found" >&2
  exit 1
fi

# 1) 정적 reference 섹션 출력
#    `## <CODE>` 헤더부터 다음 `## ` (대문자 시작, code 패턴) 또는 </catalog>, 파일 끝까지.
awk -v code="## $CODE" '
  BEGIN { in_section = 0 }
  $0 == code {
    in_section = 1
    print $0
    next
  }
  in_section && /^## [A-Z]/ { exit }
  in_section && /^<\/catalog>/ { exit }
  in_section { print $0 }
' "$REF_FILE"

# 2) DICL: 동일 code를 fix한 reviewed-pass plan의 fix_action 스니펫 추가 (기법 16)
#    .firebat/plan/*.md 에서 `**code**: <CODE>` 포함된 finding 블록 찾아
#    그 블록의 fix_action 부분을 인용. 첫 매치 1개만.
PLAN_DIR=".firebat/plan"
if [[ -d "$PLAN_DIR" ]]; then
  PAST_PLAN=$(grep -lE "\\*\\*code\\*\\*: $CODE\$" "$PLAN_DIR"/[0-9][0-9]-*.md 2>/dev/null | head -1 || true)
  if [[ -n "$PAST_PLAN" ]]; then
    # 해당 code 블록의 fix_action 라인부터 verification 라인 직전까지 추출
    # plan 본문의 필드는 "- **code**: ..." 같이 bullet으로 시작하기도 함
    SNIPPET=$(awk -v code="$CODE" '
      /\*\*code\*\*: / { match($0, /\*\*code\*\*: (.*)/, a); current_code = a[1]; gsub(/[ \t]+$/, "", current_code) }
      /\*\*fix_action\*\*: / && current_code == code { capture = 1 }
      capture && /\*\*verification\*\*: / { capture = 0; exit }
      capture { print }
    ' "$PAST_PLAN")
    if [[ -n "$SNIPPET" ]]; then
      echo
      echo "<past-fix-example source=\"$(basename "$PAST_PLAN")\">"
      echo "$SNIPPET"
      echo "</past-fix-example>"
    fi
  fi
fi
