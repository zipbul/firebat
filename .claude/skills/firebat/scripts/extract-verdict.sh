#!/bin/bash
# extract-verdict.sh — subagent 출력에서 <tag>...</tag> 블록 JSON 추출
#
# 사용: echo "$OUTPUT" | extract-verdict.sh <tag>
#   tag: verdict 또는 execution-summary
#
# 코드 펜스(```) 허용, 라인 어디에 있든 블록 추출.
# 블록이 유효 JSON이면 출력, 아니면 비어있음 + exit 1.

set -euo pipefail
export LC_ALL=C.UTF-8

TAG="${1:-}"
if [[ -z "$TAG" ]]; then
  echo "usage: extract-verdict.sh <tag>" >&2
  exit 1
fi

INPUT=$(cat)

# 탐욕스럽지 않은 태그 매칭. <tag> ... </tag> 추출. 코드 펜스 허용.
# perl -0777 -nE '': whole-file read, -E: enable extended features
BLOCK=$(printf '%s\n' "$INPUT" | perl -0777 -ne "
  if (/<${TAG}>\s*(.*?)\s*<\/${TAG}>/s) {
    my \$b = \$1;
    # 코드 펜스 제거
    \$b =~ s/^\`\`\`(json)?\s*//;
    \$b =~ s/\s*\`\`\`\$//;
    print \$b;
  }
")

if [[ -z "$BLOCK" ]]; then
  echo "extract-verdict: <$TAG> block not found" >&2
  exit 1
fi

# JSON 유효성 검증
if ! echo "$BLOCK" | jq . >/dev/null 2>&1; then
  echo "extract-verdict: <$TAG> block is not valid JSON" >&2
  echo "$BLOCK" >&2
  exit 1
fi

echo "$BLOCK"
