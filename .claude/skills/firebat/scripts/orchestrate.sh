#!/bin/bash
# orchestrate.sh — firebat 외부 bash 루프 (원조 Ralph 기법)
#
# 단일 외부 while 루프: state.json의 phase를 매 반복 jq로 읽어 분기.
# Phase 2 staleness 감지 시 phase=PLANNING으로 회귀.
#
# Stagnation 감지 (기법 13): 같은 slug에 대한 reviewer FAIL이 N회 연속이면
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

# ============================================================
# Setup
# ============================================================

mkdir -p "$ROOT"

log "step 1: initial build + scan"
rescan

BLOCKERS=$(jq '.blockers' "$ROOT/scan.json")
log "initial blockers: $BLOCKERS"

if [[ "$BLOCKERS" == "0" ]]; then
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

    "$CLAUDE_BIN" -p "firebat Phase 1 iteration. Read .firebat/state.json (jq) and .firebat/plan/index.md. Execute the Phase 1 procedure from .claude/skills/firebat/SKILL.md. Process one directory (planner + reviewer) OR global review this session, then end. After reviewer verdict, write the slug + result to .firebat/state.json log via jq." \
      --allowed-tools "Read,Write,Edit,Bash,Glob,Grep,Task" \
      2>&1 | sed 's/^/  [claude] /' >&2 || {
      log "iter $ITER: claude exited non-zero — continuing"
    }

    # Stagnation 검사 (기법 13 + 15): 모든 slug별 fail count 평가
    STAGNANT_SLUGS=$(jq -r --argjson lim "$STAGNATION_LIMIT" '
      .fail_log // {} | to_entries[]
      | select(.value >= $lim and (.key as $k | (.blocked // {}) | has($k) | not))
      | .key
    ' "$STATE")

    while IFS= read -r slug; do
      [[ -z "$slug" ]] && continue
      state_block "$slug" "reviewer-stagnation: $STAGNATION_LIMIT consecutive FAILs"
      # plan 파일을 review-failed로 마킹하여 plan-complete.sh가 다음 단계로 진행
      plan_file=$(ls "$ROOT"/plan/[0-9][0-9]-"$slug".md 2>/dev/null | head -1 || true)
      if [[ -n "$plan_file" ]]; then
        sed -i -E 's/^status: draft$/status: review-failed/' "$plan_file"
      fi
    done <<< "$STAGNANT_SLUGS"

  elif [[ "$PHASE" == "EXECUTING" ]]; then
    rescan
    BLOCKERS=$(jq '.blockers' "$ROOT/scan.json")
    UNCHECKED=$(grep -cE '^- \[ \]' "$ROOT/plan/index.md" 2>/dev/null || true)
    UNCHECKED="${UNCHECKED:-0}"

    # blocked slug 수 — unchecked 중 blocked인 것들은 종료 조건에서 제외
    BLOCKED_COUNT=$(jq -r '.blocked // {} | length' "$STATE")

    log "iter $ITER: blockers=$BLOCKERS unchecked=$UNCHECKED blocked=$BLOCKED_COUNT"

    # 종료: blockers=0 AND (unchecked=0 OR 모든 unchecked가 blocked)
    if [[ "$BLOCKERS" == "0" ]]; then
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

    "$CLAUDE_BIN" -p "firebat Phase 2 iteration. Read .firebat/state.json (jq) and .firebat/plan/index.md. Execute the Phase 2 procedure from .claude/skills/firebat/SKILL.md, including the staleness check in step-2. Fix one directory this session (or revert to PLANNING if staleness detected), then end." \
      --allowed-tools "Read,Write,Edit,Bash,Glob,Grep,Task" \
      2>&1 | sed 's/^/  [claude] /' >&2 || {
      log "iter $ITER: claude exited non-zero — continuing"
    }

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
