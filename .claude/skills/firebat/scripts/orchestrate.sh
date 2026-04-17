#!/bin/bash
# orchestrate.sh — firebat 외부 bash 루프 (원조 Ralph 기법)
#
# 단일 외부 while 루프: state.json의 phase를 매 반복 jq로 읽어 분기.
# Phase 2 staleness 감지 시 phase=PLANNING으로 회귀.
#
# Stagnation 감지 (기법 13): 같은 slug에 대한 linter(verify-plan.sh) FAIL이 N회 연속이면
# Cooldown 격리 (기법 15): blocked로 마킹 후 다음 slug로 진행.
#
# 종료: blockers=0 AND 모든 [x] AND 잔여 unchecked가 모두 blocked 상태일 때만.

set -euo pipefail
shopt -s nullglob
export LC_ALL=C.UTF-8

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT=".firebat"
SCRIPTS="$SKILL_DIR/scripts"
STATE="$ROOT/state.json"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"

# Cooldown 임계값 (기법 15) — 같은 slug N회 연속 FAIL → blocked
STAGNATION_LIMIT="${FIREBAT_STAGNATION_LIMIT:-3}"

log() { echo "[orchestrate] $*" >&2; }

report_exit() {
  local code=$?
  if [[ $code -ne 0 ]]; then
    log "orchestrator exited with code $code — .firebat/ preserved for inspection"
  fi
}
trap report_exit EXIT

# ============================================================
# state.json helpers (기법 19: Cascading State Reducer)
# ============================================================
#
# state.json schema:
# {
#   "phase": "PLANNING" | "EXECUTING",
#   "started_at": "2026-04-13T...",
#   "fail_log": { "<slug>": <int> },           // 연속 reviewer FAIL 카운트
#   "blocked":  { "<slug>": "<reason>" },       // stagnation 격리
#   "log":      [{ "ts": "...", "msg": "..." }]
# }

state_get() {
  local key="$1"
  jq -r ".$key // empty" "$STATE"
}

state_set() {
  local jq_expr="$1"
  local tmp
  tmp=$(mktemp)
  jq "$jq_expr" "$STATE" > "$tmp"
  mv "$tmp" "$STATE"
}

state_log() {
  local msg="$1"
  state_set ".log += [{ts: \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", msg: \"$msg\"}]"
}

state_fail_inc() {
  local slug="$1"
  state_set ".fail_log[\"$slug\"] = ((.fail_log[\"$slug\"] // 0) + 1)"
}

state_fail_reset() {
  local slug="$1"
  state_set ".fail_log[\"$slug\"] = 0"
}

state_block() {
  local slug="$1"
  local reason="$2"
  state_set ".blocked[\"$slug\"] = \"$reason\" | .fail_log[\"$slug\"] = 0"
  state_log "blocked $slug: $reason"
  log "BLOCKED $slug ($reason)"
}

# ============================================================
# Rescan helper
# ============================================================

rescan() {
  log "rescan: building firebat"
  bun run build >&2
  log "rescan: scan"
  bun dist/firebat.js --log-level error > "$ROOT/scan.json" || true
  log "rescan: split"
  bash "$SCRIPTS/scan-split.sh" >&2
}

# Phase 2 조건부 rescan (α2):
# 직전 fixer가 파일을 하나도 수정 안 했으면 source 변화 없음 → rescan 생략.
# last-fix-summary.json의 files_modified 배열이 비어있으면 skip.
maybe_rescan() {
  local summary="$ROOT/last-fix-summary.json"

  if [[ ! -f "$summary" ]]; then
    # 첫 Phase 2 iter: scan.json이 Phase 1 시점 것. 그대로 사용 가능.
    log "rescan: skipped (no prior fixer output)"
    return
  fi

  local mod_count
  mod_count=$(jq -r '.files_modified | length' "$summary" 2>/dev/null || echo 0)

  if [[ "$mod_count" == "0" ]]; then
    log "rescan: skipped (last fixer modified 0 files)"
    return
  fi

  rescan
  # summary 소비 후 제거 (다음 iter가 자기 fixer 출력을 보게 함)
  rm -f "$summary"
}

# ============================================================
# Setup
# ============================================================

mkdir -p "$ROOT"

log "step 1: initial build + scan"
rescan

TOTAL=$(jq '.total' "$ROOT/scan.json")
log "initial total findings: $TOTAL"

if [[ "$TOTAL" == "0" ]]; then
  log "clean — no findings"
  rm -rf "$ROOT"
  exit 0
fi

# state.json 초기화 (재실행이 아닌 경우)
if [[ ! -f "$STATE" ]]; then
  jq -n --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{
    phase: "PLANNING",
    started_at: $ts,
    fail_log: {},
    blocked: {},
    log: []
  }' > "$STATE"
fi

# 호환: SKILL.md가 .firebat/state.md를 참조할 수 있으므로 호환 view를 함께 작성
sync_state_md() {
  local phase
  phase=$(state_get phase)
  cat > "$ROOT/state.md" <<EOF
---
phase: $phase
---

# Firebat Orchestration State (synthesized from state.json)

Authoritative state: .firebat/state.json (read with jq).
EOF
}

# ============================================================
# 단일 외부 루프
# ============================================================

log "step 2: unified loop (terminate on blockers=0 AND no unchecked-and-non-blocked)"

ITER=0
while true; do
  ITER=$((ITER + 1))

  PHASE=$(state_get phase)
  PHASE="${PHASE:-PLANNING}"
  sync_state_md

  log "iter $ITER: phase=$PHASE"

  if [[ "$PHASE" == "PLANNING" ]]; then
    # Phase 1 완료 체크
    if bash "$SCRIPTS/plan-complete.sh" 2>/dev/null; then
      log "Phase 1 complete — transitioning to EXECUTING"
      state_set '.phase = "EXECUTING"'
      state_log "transition PLANNING -> EXECUTING"
      continue
    fi

    # α3: bash가 다음 action을 결정. claude는 Task dispatch만.
    NEXT=$(bash "$SCRIPTS/pick-next.sh" planning)
    ACTION=$(echo "$NEXT" | jq -r '.action')

    case "$ACTION" in
      plan)
        SLUG=$(echo "$NEXT" | jq -r '.slug')
        DIR=$(echo "$NEXT" | jq -r '.dir')
        PLAN_FILE=$(echo "$NEXT" | jq -r '.plan_file')
        FEEDBACK=$(echo "$NEXT" | jq -r '.feedback_file')

        log "iter $ITER: plan dir=$DIR slug=$SLUG"

        "$CLAUDE_BIN" -p "Invoke firebat-planner agent via Task tool with: DIR_SLUG='$SLUG', DIR_PATH='$DIR', PLAN_FILE='$PLAN_FILE', FEEDBACK_FILE='$FEEDBACK'. The agent writes the plan file. Return when the Task completes." \
          --allowed-tools "Task" \
          2>&1 | sed 's/^/  [claude] /' >&2 || {
          log "iter $ITER: claude exited non-zero — continuing"
        }

        # bash가 verify + index.md + feedback 처리
        bash "$SCRIPTS/post-plan-verify.sh" "$PLAN_FILE" "$SLUG" >/dev/null
        ;;
      global-review)
        log "iter $ITER: global review"
        CLAUDE_OUT=$(mktemp -t firebat-claude.XXXXXX.txt)
        "$CLAUDE_BIN" -p "Invoke firebat-global-reviewer agent via Task tool. The agent returns a <verdict> JSON block. Just dispatch the Task and return when done — do not modify files yourself." \
          --allowed-tools "Task" \
          > "$CLAUDE_OUT" 2>&1 || {
          log "iter $ITER: global reviewer exited non-zero — continuing"
        }
        # 로그 출력 + 파일 기반 post 처리
        sed 's/^/  [claude] /' < "$CLAUDE_OUT" >&2 || true
        bash "$SCRIPTS/post-global-review.sh" < "$CLAUDE_OUT"
        rm -f "$CLAUDE_OUT"
        ;;
      none)
        log "iter $ITER: Phase 1 idle — $(echo "$NEXT" | jq -r '.reason // "no action"')"
        ;;
    esac

    # Stagnation 검사: verify-plan.sh FAIL 연속 N회면 blocked
    STAGNANT_SLUGS=$(jq -r --argjson lim "$STAGNATION_LIMIT" '
      .fail_log // {} | to_entries[]
      | select(.value >= $lim and (.key as $k | (.blocked // {}) | has($k) | not))
      | .key
    ' "$STATE")

    while IFS= read -r slug; do
      [[ -z "$slug" ]] && continue
      state_block "$slug" "linter-stagnation: $STAGNATION_LIMIT consecutive FAILs"
      # glob-safe lookup (nullglob + ls에 매치 없는 glob 전달 시 cwd 나열되는 함정 회피)
      _cand=("$ROOT"/plan/[0-9][0-9]-"$slug".md)
      if [[ ${#_cand[@]} -gt 0 && -e "${_cand[0]}" ]]; then
        sed -i -E 's/^status: draft$/status: review-failed/' "${_cand[0]}"
      fi
    done <<< "$STAGNANT_SLUGS"

  elif [[ "$PHASE" == "EXECUTING" ]]; then
    maybe_rescan

    # Staleness 감지: 새 findings 있으면 해당 dir을 draft로 되돌리고 PLANNING 회귀
    if ! bash "$SCRIPTS/staleness-check.sh" >/dev/null; then
      log "iter $ITER: staleness detected — regressing to PLANNING"
      state_set '.phase = "PLANNING"'
      state_log "staleness regression: phase -> PLANNING"
      continue
    fi

    TOTAL=$(jq '.total' "$ROOT/scan.json")
    UNCHECKED=$(grep -cE '^- \[ \]' "$ROOT/plan/index.md" 2>/dev/null || true)
    UNCHECKED="${UNCHECKED:-0}"

    # blocked slug 수 — unchecked 중 blocked인 것들은 종료 조건에서 제외
    BLOCKED_COUNT=$(jq -r '.blocked // {} | length' "$STATE")

    log "iter $ITER: blockers=$TOTAL unchecked=$UNCHECKED blocked=$BLOCKED_COUNT"

    # 종료: blockers=0 AND (unchecked=0 OR 모든 unchecked가 blocked)
    if [[ "$TOTAL" == "0" ]]; then
      # unchecked slug 중 blocked가 아닌 것이 0개여야 종료
      if [[ "$UNCHECKED" == "0" ]]; then
        log "Phase 2 complete — blockers=0, all dirs checked"
        break
      fi

      # unchecked가 모두 blocked인지 확인
      UNCHECKED_NON_BLOCKED=0
      while IFS= read -r entry; do
        slug=$(echo "$entry" | awk '{print $3}')
        is_blocked=$(jq -r --arg s "$slug" '.blocked // {} | has($s)' "$STATE")
        if [[ "$is_blocked" != "true" ]]; then
          UNCHECKED_NON_BLOCKED=$((UNCHECKED_NON_BLOCKED + 1))
        fi
      done < <(grep -E '^- \[ \] ' "$ROOT/plan/index.md" 2>/dev/null || true)

      if [[ "$UNCHECKED_NON_BLOCKED" == "0" ]]; then
        log "Phase 2 terminated — blockers=0, $BLOCKED_COUNT slugs blocked (manual review needed)"
        log "BLOCKED slugs: $(jq -r '.blocked // {} | keys | join(", ")' "$STATE")"
        # 정리 보류, 사용자가 .firebat/state.json 검토하도록
        log "preserving .firebat/ for blocked-slug review"
        exit 2
      fi
    fi

    # α3: Phase 2도 bash 라우팅. staleness 체크는 SKILL.md Phase 2 step-2에 있지만
    # 간소화를 위해 claude가 fixer만 dispatch. staleness는 다음 iter rescan 후 감지.
    NEXT=$(bash "$SCRIPTS/pick-next.sh" executing)
    ACTION=$(echo "$NEXT" | jq -r '.action')

    if [[ "$ACTION" == "fix" ]]; then
      SLUG=$(echo "$NEXT" | jq -r '.slug')
      DIR=$(echo "$NEXT" | jq -r '.dir')
      PLAN_FILE=$(echo "$NEXT" | jq -r '.plan_file')

      log "iter $ITER: fix dir=$DIR slug=$SLUG"

      CLAUDE_OUT=$(mktemp -t firebat-claude.XXXXXX.txt)
      "$CLAUDE_BIN" -p "Invoke firebat-fixer agent via Task tool with: DIR_SLUG='$SLUG', DIR_PATH='$DIR', PLAN_FILE='$PLAN_FILE'. The agent returns an <execution-summary> JSON block. Just dispatch the Task and return when done — do not write files yourself." \
        --allowed-tools "Task" \
        > "$CLAUDE_OUT" 2>&1 || {
        log "iter $ITER: claude exited non-zero — continuing"
      }
      # 로그 + bash 후처리 (summary 저장, index.md, blocked 기록)
      sed 's/^/  [claude] /' < "$CLAUDE_OUT" >&2 || true
      bash "$SCRIPTS/post-fix.sh" "$SLUG" < "$CLAUDE_OUT"
      rm -f "$CLAUDE_OUT"
    else
      log "iter $ITER: Phase 2 idle — $(echo "$NEXT" | jq -r '.reason // "no action"')"
    fi

  else
    log "ERROR: unknown phase '$PHASE' — aborting"
    exit 1
  fi
done

# ============================================================
# Cleanup
# ============================================================

log "step 3: cleanup"
rm -rf "$ROOT"
log "DONE — all blockers resolved"
