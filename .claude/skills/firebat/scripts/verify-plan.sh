#!/bin/bash
# verify-plan.sh — Plan 파일에 대한 deterministic 검증 (가드레일 3계층 중 linter 계층)
#
# Reviewer LLM의 verdict를 신뢰하지 않고 mechanical 재검증.
# 9개 체크 중 LLM 필요한 1개(C7 자식 plan 충돌)는 제외, 8개를 bash/jq/grep으로 검증.
#
# 사용: verify-plan.sh <PLAN_FILE> <DIR_SLUG>
#
# 출력: JSON verdict — reviewer.md의 verdict와 동일 schema
#   { result: PASS|FAIL, checks: {...}, feedback_for_planner: [...] }
#
# Exit code: 0 = PASS, 1 = FAIL, 2 = invocation error

set -euo pipefail
shopt -s nullglob
export LC_ALL=C.UTF-8

PLAN_FILE="${1:-}"
DIR_SLUG="${2:-}"

if [[ -z "$PLAN_FILE" || -z "$DIR_SLUG" ]]; then
  echo "usage: verify-plan.sh <PLAN_FILE> <DIR_SLUG>" >&2
  exit 2
fi

if [[ ! -f "$PLAN_FILE" ]]; then
  echo "verify-plan: PLAN_FILE not found: $PLAN_FILE" >&2
  exit 2
fi

BY_DIR=".firebat/by-dir/$DIR_SLUG.json"
if [[ ! -f "$BY_DIR" ]]; then
  echo "verify-plan: by-dir not found: $BY_DIR" >&2
  exit 2
fi

# ============================================================
# 검증 결과 누적
# ============================================================

declare -A CHECK_PASS
declare -A CHECK_EVIDENCE
declare -a FEEDBACK_JSON_ARR=()

set_check() {
  local id="$1"; local pass="$2"; local evidence="$3"
  CHECK_PASS["$id"]="$pass"
  CHECK_EVIDENCE["$id"]="$evidence"
}

add_feedback() {
  local check_id="$1"; local issue="$2"; local required_change="$3"
  FEEDBACK_JSON_ARR+=("$(jq -n \
    --arg c "$check_id" --arg i "$issue" --arg r "$required_change" \
    '{check_id: $c, issue: $i, required_change: $r}')")
}

# ============================================================
# Plan body (frontmatter 제외) 추출
# ============================================================

PLAN_BODY=$(awk 'BEGIN{f=0} /^---$/{f++; next} f>=2{print}' "$PLAN_FILE")
PRIMARY_COUNT=$(jq '[.findings[] | select(.primary)] | length' "$BY_DIR")
SECONDARY_ONLY=$(awk '/^---$/{f=!f; next} f && /^secondary_only:/{print $2; exit}' "$PLAN_FILE")
SECONDARY_ONLY="${SECONDARY_ONLY:-false}"

# ============================================================
# C1: Primary finding coverage (vacuous-pass forbidden)
# ============================================================

if [[ "$PRIMARY_COUNT" == "0" ]]; then
  # Case B: 0 primary → secondary_only:true + no-op step required
  HAS_NO_OP=$(echo "$PLAN_BODY" | grep -cE "^- \[ \] no-op-${DIR_SLUG}\$" || true)
  if [[ "$SECONDARY_ONLY" == "true" && "$HAS_NO_OP" -ge 1 ]]; then
    set_check "C1" "true" "primary=0, secondary_only=true, no-op step present"
  else
    set_check "C1" "false" "primary=0 but missing secondary_only:true or no-op-${DIR_SLUG} step (vacuous-pass forbidden)"
    add_feedback "C1" "0 primary findings but plan lacks secondary_only:true frontmatter or no-op step" \
      "Use Secondary-only mode: add 'secondary_only: true' to frontmatter and a step '- [ ] no-op-${DIR_SLUG}'."
  fi
else
  # Case A: primary > 0 → 모든 ID 매핑
  MISSING_IDS=()
  while IFS= read -r fid; do
    if ! grep -qE "(^|[^[:alnum:]-])${fid}([^[:alnum:]-]|$)" "$PLAN_FILE"; then
      MISSING_IDS+=("$fid")
    fi
  done < <(jq -r '.findings[] | select(.primary) | .id' "$BY_DIR")

  if [[ ${#MISSING_IDS[@]} -eq 0 ]]; then
    set_check "C1" "true" "$PRIMARY_COUNT primary IDs all present"
  else
    set_check "C1" "false" "${#MISSING_IDS[@]} missing IDs: ${MISSING_IDS[*]:0:3}"
    add_feedback "C1" "Missing primary finding IDs in Steps section" \
      "Add checkbox lines for: ${MISSING_IDS[*]}"
  fi
fi

# ============================================================
# C2: 상태 서술 금지 (Quality Assessment 섹션 내)
# ============================================================

QA_BLOCK=$(awk '/^## Quality Assessment/,/^## Steps/' "$PLAN_FILE" || true)
STATUS_PATTERNS='위반 없음|no violation|적절함|fine as-is|seems fine|looks good|문제 없음|^없음$|^none$'
QA_MATCHES=$(echo "$QA_BLOCK" | grep -niE "$STATUS_PATTERNS" || true)

if [[ -z "$QA_MATCHES" ]]; then
  set_check "C2" "true" "no status statements in Quality Assessment"
else
  FIRST_MATCH=$(echo "$QA_MATCHES" | head -1)
  set_check "C2" "false" "matched: $FIRST_MATCH"
  add_feedback "C2" "Quality Assessment contains status statement: $FIRST_MATCH" \
    "Omit subsections where no concrete problem exists. Do not write 'no violation' or 'fine'."
fi

# ============================================================
# C3: Finding block completeness (9 fields)
# ============================================================

REQUIRED_FIELDS=("category" "code" "location" "root_cause" "fix_action" "verification" "rollback_trigger" "new_finding_risk" "cross_dir_refs")
MISSING_FIELDS_PER_BLOCK=()

if [[ "$PRIMARY_COUNT" -gt 0 ]]; then
  # 각 finding 블록 (### <id>) 별로 9개 필드 확인
  while IFS= read -r fid; do
    BLOCK=$(awk -v id="### $fid" '
      $0 == id { in_block = 1 }
      in_block && /^### / && $0 != id { exit }
      in_block { print }
    ' "$PLAN_FILE")
    [[ -z "$BLOCK" ]] && continue

    for field in "${REQUIRED_FIELDS[@]}"; do
      if ! echo "$BLOCK" | grep -qE "\\*\\*${field}\\*\\*:"; then
        MISSING_FIELDS_PER_BLOCK+=("$fid:$field")
      fi
    done
  done < <(jq -r '.findings[] | select(.primary) | .id' "$BY_DIR")
fi

if [[ ${#MISSING_FIELDS_PER_BLOCK[@]} -eq 0 ]]; then
  set_check "C3" "true" "all blocks have 9 fields"
else
  set_check "C3" "false" "${#MISSING_FIELDS_PER_BLOCK[@]} missing: ${MISSING_FIELDS_PER_BLOCK[*]:0:3}"
  add_feedback "C3" "Finding blocks missing required fields" \
    "Add missing fields: ${MISSING_FIELDS_PER_BLOCK[*]}"
fi

# ============================================================
# C4: 카테고리 우선순위 정렬
# ============================================================

declare -A CAT_PRIORITY=(
  ["dependencies"]=1 ["coupling"]=2 ["error-flow"]=3
  ["nesting"]=4 ["early-return"]=4 ["collapsible-if"]=4
  ["waste"]=5
  ["barrel"]=6 ["unknown-proof"]=6 ["indirection"]=6
  ["variable-lifetime"]=7 ["temporal-coupling"]=7 ["giant-file"]=7
  ["duplicates"]=8
  ["lint"]=9 ["format"]=9 ["typecheck"]=9
)

STEP_CATEGORIES=$(grep -oE '^### Step [0-9]+: [a-z-]+' "$PLAN_FILE" | awk '{print $NF}' || true)
PREV_PRIO=0
ORDER_OK=true
ORDER_VIOLATION=""

for cat in $STEP_CATEGORIES; do
  prio="${CAT_PRIORITY[$cat]:-99}"
  if [[ "$prio" -lt "$PREV_PRIO" ]]; then
    ORDER_OK=false
    ORDER_VIOLATION="$cat (priority $prio) appears after priority $PREV_PRIO"
    break
  fi
  PREV_PRIO="$prio"
done

if [[ "$ORDER_OK" == "true" ]]; then
  set_check "C4" "true" "step order respects category priority"
else
  set_check "C4" "false" "out-of-order: $ORDER_VIOLATION"
  add_feedback "C4" "Step categories not in priority order: $ORDER_VIOLATION" \
    "Reorder Steps: dependencies(1) > coupling(2) > error-flow(3) > nesting/early-return/collapsible-if(4) > waste(5) > barrel/unknown-proof/indirection(6) > variable-lifetime/temporal-coupling/giant-file(7) > duplicates(8) > lint/format/typecheck(9)"
fi

# ============================================================
# C5: Cross-Directory Decisions deferral 검출
# ============================================================

CDD_BLOCK=$(awk '/^## Cross-Directory Decisions Locked/,0' "$PLAN_FILE" || true)
DEFERRAL_PATTERNS='나중에|TBD|to be determined|to be decided|will decide|pending|parent plan|parent will|parent defines|yields to|finalized by|selected by|awaits?|subject to'

if [[ -z "$CDD_BLOCK" ]]; then
  set_check "C5" "false" "Cross-Directory Decisions Locked section missing"
  add_feedback "C5" "Section missing" "Add '## Cross-Directory Decisions Locked' section. Use 'None.' if no cross-dir decisions."
else
  CDD_MATCHES=$(echo "$CDD_BLOCK" | grep -niE "$DEFERRAL_PATTERNS" || true)
  if [[ -z "$CDD_MATCHES" ]]; then
    set_check "C5" "true" "no deferral patterns"
  else
    FIRST=$(echo "$CDD_MATCHES" | head -1)
    set_check "C5" "false" "deferral: $FIRST"
    add_feedback "C5" "Cross-Directory Decisions contains deferral pattern: $FIRST" \
      "Make the decision concretely now. Do not defer to other plans, parent plans, or 'primary owners'."
  fi
fi

# ============================================================
# C6: Step checkbox ID = primary finding ID 매칭
# ============================================================

CHECKBOX_IDS=$(grep -oE '^- \[[ x]\] [a-z-]+-[0-9a-f]{12}(-i[0-9]+)?' "$PLAN_FILE" | awk '{print $NF}' | sort -u || true)
PRIMARY_IDS_LIST=$(jq -r '.findings[] | select(.primary) | .id' "$BY_DIR" | sort -u)

# 추가 체크박스 (primary 아닌 ID)
EXTRA_IDS=$(comm -23 <(echo "$CHECKBOX_IDS") <(echo "$PRIMARY_IDS_LIST") | grep -v '^no-op-' || true)
if [[ -z "$EXTRA_IDS" ]]; then
  set_check "C6" "true" "all checkbox IDs are primary findings (or no-op)"
else
  EXTRA_FIRST=$(echo "$EXTRA_IDS" | head -1)
  set_check "C6" "false" "unknown checkbox IDs: $EXTRA_FIRST"
  add_feedback "C6" "Steps contain checkbox IDs not in by-dir JSON: $(echo "$EXTRA_IDS" | tr '\n' ' ')" \
    "Remove these checkbox lines or correct the IDs."
fi

# C7 — cross-plan semantic conflict: deferred to global-reviewer G6
# (broader check: detects conflicts across ALL plans, not just direct children).
# Removing per-plan C7 saves an LLM call per review; G6 catches the same issues.
set_check "C7" "true" "deferred to global-reviewer G6"

# ============================================================
# C8: Vague actions
# ============================================================

VAGUE_PATTERNS='리팩토링한다\.|refactor\.$|improve\.$|clean up\.$|make better\.$|enhance\.$'
VAGUE_MATCHES=$(grep -niE "$VAGUE_PATTERNS" "$PLAN_FILE" || true)

if [[ -z "$VAGUE_MATCHES" ]]; then
  set_check "C8" "true" "no vague standalone actions"
else
  FIRST=$(echo "$VAGUE_MATCHES" | head -1)
  set_check "C8" "false" "vague: $FIRST"
  add_feedback "C8" "Vague action verb without concrete target: $FIRST" \
    "Replace with concrete action (function name, file path, exact change)."
fi

# ============================================================
# C8-b: Line number anchors (모든 본문 필드 검사)
# ============================================================

LINE_ANCHOR_PATTERNS='\bline\s+[0-9]+|\bat\s+line\s+[0-9]+|\(line\s+[0-9]+\)|\blines?\s+[0-9]+(-[0-9]+|\s*and\s*[0-9]+)?'
# location 필드는 허용. fix_action / rollback_trigger / cross_dir_refs / root_cause 본문에서만 검사.
LINE_MATCHES=$(awk '
  /^- \*\*location\*\*/ { next }   # location 필드 스킵
  /^- \*\*[a-z_]+\*\*:/ { print }
  in_block && /^- \*\*[a-z_]+\*\*:/ { in_block = 0 }
' "$PLAN_FILE" | grep -niE "$LINE_ANCHOR_PATTERNS" || true)

if [[ -z "$LINE_MATCHES" ]]; then
  set_check "C8-b" "true" "no line number anchors in body fields"
else
  FIRST=$(echo "$LINE_MATCHES" | head -1)
  set_check "C8-b" "false" "line anchor: $FIRST"
  add_feedback "C8-b" "Line number used as anchor in body field: $FIRST" \
    "Replace 'line N' with function name, symbol name, or declaration reference. Line numbers belong only in **location** field."
fi

# ============================================================
# C9: cross_dir_refs body validity
# ============================================================

CROSS_DIR_VIOLATIONS=()
if [[ "$PRIMARY_COUNT" -gt 0 ]]; then
  while IFS= read -r entry; do
    fid=$(echo "$entry" | jq -r '.id')
    has_group=$(echo "$entry" | jq -r '.groupId != null')

    BLOCK=$(awk -v id="### $fid" '
      $0 == id { in_block = 1 }
      in_block && /^### / && $0 != id { exit }
      in_block { print }
    ' "$PLAN_FILE")

    if [[ -z "$BLOCK" ]]; then
      CROSS_DIR_VIOLATIONS+=("$fid: finding block missing from plan (### $fid not found)")
      continue
    fi

    CDREF=$(echo "$BLOCK" | grep -E '^- \*\*cross_dir_refs\*\*:' | head -1 | sed -E 's/^- \*\*cross_dir_refs\*\*:[[:space:]]*//' || true)

    if [[ -z "$CDREF" ]]; then
      CROSS_DIR_VIOLATIONS+=("$fid: cross_dir_refs field missing or empty on its line")
      continue
    fi

    if [[ "$has_group" == "true" ]]; then
      # groupId 있음 → tuple 1개 이상 필요
      # 검증: directory + file + relation 키워드 모두 포함
      if echo "$CDREF" | grep -qiE '^(none\.?|n/a)$'; then
        CROSS_DIR_VIOLATIONS+=("$fid: groupId present but cross_dir_refs is None")
      elif ! echo "$CDREF" | grep -qiE 'directory[: ]'; then
        CROSS_DIR_VIOLATIONS+=("$fid: cross_dir_refs missing 'directory' keyword")
      elif ! echo "$CDREF" | grep -qiE 'file[: ]'; then
        CROSS_DIR_VIOLATIONS+=("$fid: cross_dir_refs missing 'file' keyword")
      elif ! echo "$CDREF" | grep -qiE 'relation[: ]'; then
        CROSS_DIR_VIOLATIONS+=("$fid: cross_dir_refs missing 'relation' keyword")
      fi
    else
      # groupId 없음 → None.
      if ! echo "$CDREF" | grep -qiE '^none\.?$'; then
        CROSS_DIR_VIOLATIONS+=("$fid: groupId null but cross_dir_refs is not 'None.'")
      fi
    fi
  done < <(jq -c '.findings[] | select(.primary)' "$BY_DIR")
fi

if [[ ${#CROSS_DIR_VIOLATIONS[@]} -eq 0 ]]; then
  set_check "C9" "true" "all cross_dir_refs valid"
else
  set_check "C9" "false" "${#CROSS_DIR_VIOLATIONS[@]} violations: ${CROSS_DIR_VIOLATIONS[*]:0:2}"
  add_feedback "C9" "cross_dir_refs format invalid: ${CROSS_DIR_VIOLATIONS[*]}" \
    "If finding has groupId, write '- directory: <dir>, file: <path>, relation: <description>'. If no groupId, write 'None.'"
fi

# ============================================================
# 최종 verdict 생성
# ============================================================

OVERALL_PASS=true
for id in "${!CHECK_PASS[@]}"; do
  if [[ "${CHECK_PASS[$id]}" == "false" ]]; then
    OVERALL_PASS=false
    break
  fi
done

# JSON 조립
CHECKS_JSON="{}"
for id in "${!CHECK_PASS[@]}"; do
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
    --arg k "$id" --argjson p "${CHECK_PASS[$id]}" --arg e "${CHECK_EVIDENCE[$id]}" \
    '. + {($k): {pass: $p, evidence: $e}}')
done

if [[ ${#FEEDBACK_JSON_ARR[@]} -eq 0 ]]; then
  FEEDBACK_JSON="[]"
else
  FEEDBACK_JSON=$(printf '%s\n' "${FEEDBACK_JSON_ARR[@]}" | jq -s .)
fi

if [[ "$OVERALL_PASS" == "true" ]]; then
  RESULT="PASS"
else
  RESULT="FAIL"
fi

jq -n \
  --arg result "$RESULT" \
  --arg plan_file "$PLAN_FILE" \
  --arg dir_slug "$DIR_SLUG" \
  --argjson checks "$CHECKS_JSON" \
  --argjson feedback "$FEEDBACK_JSON" \
  '{
    result: $result,
    plan_file: $plan_file,
    dir_slug: $dir_slug,
    checks: $checks,
    feedback_for_planner: $feedback
  }'

if [[ "$OVERALL_PASS" == "true" ]]; then
  exit 0
else
  exit 1
fi
