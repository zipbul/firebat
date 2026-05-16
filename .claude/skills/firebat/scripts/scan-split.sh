#!/bin/bash
# scan-split.sh — firebat scan 결과를 디렉토리별로 분할
#
# Input: .firebat/scan.json — 새 flat Finding[] 포맷
#   { meta: { detectors, errors? }, total, findings: [{id, category, code, file, line, kind, label, groupId?, primary?, detail?}] }
#
# ID는 scan 단계에서 부여됨 (content-hash).
# Optional 필드 규약: groupId 없음 = null, primary 없음 = true.
#
# Output:
#   .firebat/tree.json                    디렉토리 계층 + 카운트
#   .firebat/by-dir/<slug>.json           디렉토리별 findings (detail 포함)
#   .firebat/by-dir-slim/<slug>.json      primary만, detail 제외 — planner 입력
#   .firebat/finding-index.json           전역 인덱스 — global-reviewer 입력 (ALL by-dir 대체)

set -euo pipefail
shopt -s nullglob
export LC_ALL=C.UTF-8

ROOT=".firebat"
SCAN="$ROOT/scan.json"
TREE="$ROOT/tree.json"
INDEX="$ROOT/finding-index.json"
BY_DIR="$ROOT/by-dir"
BY_DIR_SLIM="$ROOT/by-dir-slim"

if [[ ! -f "$SCAN" ]]; then
  echo "scan-split: $SCAN not found" >&2
  exit 1
fi

mkdir -p "$BY_DIR" "$BY_DIR_SLIM"
rm -f "$BY_DIR"/*.json "$BY_DIR_SLIM"/*.json 2>/dev/null || true

# Detector errors (partial-failure signal). Propagated into every agent-consumed
# projection so planner / global-reviewer can branch on (.scanErrors | length) > 0
# without reading raw scan.json.
SCAN_ERRORS=$(jq -c '.meta.errors // {}' "$SCAN")

# 임시 파일 (findings 수가 많을 때 ARG_MAX 회피)
ENRICHED_FILE=$(mktemp -t firebat-enriched.XXXXXX.json)
trap 'rm -f "$ENRICHED_FILE"' EXIT

# ── 1) Enrich: dir 도출 + optional 필드 실체화 ───────────────────────────────
# dir: file path에서 directory 추출. file=""이면 dir="".
# primary/groupId: 누락 시 기본값 주입 (primary: true, groupId: null).
jq -c '
  [.findings[] | . + {
    dir: (.file | split("/") | .[:-1] | join("/")),
    primary: (.primary // true),
    groupId: (.groupId // null)
  }]
' "$SCAN" > "$ENRICHED_FILE"

TOTAL_FINDINGS=$(jq 'length' "$ENRICHED_FILE")
echo "scan-split: $TOTAL_FINDINGS findings"

if [[ "$TOTAL_FINDINGS" == "0" ]]; then
  echo '[]' > "$TREE"
  jq -n --argjson scanErrors "$SCAN_ERRORS" \
    '{primaryIds: [], groups: {}, dirs: {}, scanErrors: $scanErrors}' > "$INDEX"
  echo "scan-split: done (empty)"
  exit 0
fi

# ── 2) by-dir: 디렉토리별 그룹핑 ──────────────────────────────────────────────
# dir="" (프로젝트 루트) → slug="__root__"
# dir="src/engine/ast" → slug="src__engine__ast"
jq -c '
  group_by(.dir)[] |
  {
    dir: .[0].dir,
    slug: (if .[0].dir == "" then "__root__" else (.[0].dir | gsub("/"; "__")) end),
    findings: .
  }
' "$ENRICHED_FILE" | while IFS= read -r line; do
  slug=$(echo "$line" | jq -r '.slug')
  echo "$line" | jq '.' > "$BY_DIR/$slug.json"
done

_bdf=("$BY_DIR"/*.json); BY_DIR_COUNT=${#_bdf[@]}
[[ $BY_DIR_COUNT -gt 0 && ! -e "${_bdf[0]}" ]] && BY_DIR_COUNT=0
echo "scan-split: $BY_DIR_COUNT by-dir files"

# ── 3) tree.json ─────────────────────────────────────────────────────────────
jq '
  group_by(.dir) | map({
    dir: .[0].dir,
    slug: (if .[0].dir == "" then "__root__" else (.[0].dir | gsub("/"; "__")) end),
    depth: (if .[0].dir == "" then 0 else (.[0].dir | split("/") | length) end),
    parent: (
      if .[0].dir == "" then null
      elif (.[0].dir | split("/") | length) == 1 then ""
      else (.[0].dir | split("/") | .[:-1] | join("/"))
      end
    ),
    findingCount: ([.[] | select(.primary)] | length),
    findingCountTotal: length,
    categories: ([.[] | .category] | group_by(.) | map({key: .[0], value: length}) | from_entries),
    findingIds: [.[] | .id]
  }) | sort_by(-.depth, .dir)
' "$ENRICHED_FILE" > "$TREE"

echo "scan-split: tree.json written"

# ── 4) by-dir-slim: planner 입력 ─────────────────────────────────────────────
# primary findings만, detail 제외, hasCrossDirSecondary 계산 포함.
# groupId로 묶인 findings가 2개 이상의 dir에 분포하면 hasCrossDirSecondary=true.
SLIM_FILE=$(mktemp -t firebat-slim.XXXXXX.json)
trap 'rm -f "$ENRICHED_FILE" "$SLIM_FILE"' EXIT

jq '
  (map(select(.groupId != null)) | group_by(.groupId) | map({
    key: .[0].groupId,
    value: ([.[] | .dir] | unique)
  }) | from_entries) as $groupDirs |
  group_by(.dir) | map({
    slug: (if .[0].dir == "" then "__root__" else (.[0].dir | gsub("/"; "__")) end),
    dir: .[0].dir,
    primaryFindings: [.[] | select(.primary) | {
      id, category, code, file, line, kind, label,
      groupId,
      hasCrossDirSecondary: (
        if .groupId == null then false
        else (($groupDirs[.groupId] // []) | length) > 1
        end
      )
    }]
  })
' "$ENRICHED_FILE" > "$SLIM_FILE"

jq -c '.[]' "$SLIM_FILE" | while IFS= read -r line; do
  slug=$(echo "$line" | jq -r '.slug')
  echo "$line" | jq --argjson scanErrors "$SCAN_ERRORS" '{
    slug,
    dir,
    primaryCount: (.primaryFindings | length),
    categoryCounts: (
      [.primaryFindings[] | .category] | group_by(.) |
      map({key: .[0], value: length}) | from_entries
    ),
    primaryFindings,
    scanErrors: $scanErrors
  }' > "$BY_DIR_SLIM/$slug.json"
done

_sf=("$BY_DIR_SLIM"/*.json); SLIM_COUNT=${#_sf[@]}
[[ $SLIM_COUNT -gt 0 && ! -e "${_sf[0]}" ]] && SLIM_COUNT=0
echo "scan-split: $SLIM_COUNT slim files"

# ── 5) finding-index.json: 전역 인덱스 (global-reviewer 전용) ────────────────
# ALL by-dir 파일을 읽을 필요 없이 이 한 파일로 G2/G2-b/G7 체크 가능.
#   - primaryIds: 모든 primary finding ID
#   - groups[groupId]: { primary: {id, dir, file}, secondaries: [{id, dir, file}] }
#   - dirs[dir]: { findingCount, primaryIds[] }
jq --argjson scanErrors "$SCAN_ERRORS" '
  {
    primaryIds: [.[] | select(.primary) | .id],
    groups: (
      map(select(.groupId != null)) | group_by(.groupId) | map({
        key: .[0].groupId,
        value: {
          primary: (map(select(.primary))[0] // null | if . then {id: .id, dir: .dir, file: .file} else null end),
          secondaries: [.[] | select(.primary | not) | {id, dir, file}]
        }
      }) | from_entries
    ),
    dirs: (
      group_by(.dir) | map({
        key: .[0].dir,
        value: {
          findingCount: length,
          primaryIds: [.[] | select(.primary) | .id]
        }
      }) | from_entries
    ),
    scanErrors: $scanErrors
  }
' "$ENRICHED_FILE" > "$INDEX"

echo "scan-split: finding-index.json written"
echo "scan-split: done"
