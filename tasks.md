# Development Tasks

> Generated from: `2026_02_13_claude_code_telegram_remote_wrapper/prd.md`
> Generated on: 2026-02-13

## Overview

### Development Phases
- **POC**: Prove remote control loop (Telegram → Claude Code → sanitized response).
- **MVP**: Production-ready single-concurrent-connection wrapper with audit logging and stable session lifecycle.
- **Full Release**: Better UX and optional scale-up paths after safety hardening.

### Key Dependencies
- macOS host with working Claude Code terminal auth/session.
- Telegram Bot API token + webhook/polling transport.
- Output sanitization + regex masking must be in place before broad use.

---

## Dependencies Map

### Visual Dependency Graph

```text
[1.1] ─┬─> [1.4] ───────────────┬────────> [2.2] ──> [3.1] ──> [3.4]
[1.2] ─┘                        │
[1.3] ────────────────> [2.3] ──┼────────> [3.2]
[1.5] ────────────────> [2.4] ──┘
[2.1] ───────────────────────────────────────> [3.1]
[2.5] ───────────────────────────────────────> [3.3]
```

### Dependency Table

| Task ID | Task Title | Depends On | Blocks | Can Parallel With |
|---|---|---|---|---|
| 1.1 | Define bot command contract | None | 1.4, 2.2 | 1.2, 1.3, 1.5 |
| 1.2 | Implement Telegram transport skeleton | None | 1.4, 2.2 | 1.1, 1.3, 1.5 |
| 1.3 | Implement Claude process adapter | None | 2.3, 3.2 | 1.1, 1.2, 1.5 |
| 1.4 | Build end-to-end command routing POC | 1.1, 1.2 | 2.2, 3.1 | 1.5 |
| 1.5 | Define audit event schema + log path policy | None | 2.4 | 1.1, 1.2, 1.3 |
| 2.1 | Implement connection lock manager | 1.4 | 3.1 | 2.2, 2.3, 2.4 |
| 2.2 | Implement session lifecycle manager | 1.4 | 3.1, 3.4 | 2.1, 2.3, 2.4 |
| 2.3 | Build outbound sanitization pipeline | 1.3 | 3.2, 3.4 | 2.1, 2.2, 2.4 |
| 2.4 | Implement per-session audit writer | 1.5 | 3.3, 3.4 | 2.1, 2.2, 2.3 |
| 2.5 | Implement deterministic regex masking engine | 1.3 | 3.2, 3.3 | 2.1, 2.2, 2.4 |
| 3.1 | Enforce hard lock behavior in commands | 2.1, 2.2 | 3.4 | 3.2, 3.3 |
| 3.2 | Integrate sanitization + regex fallback into outbound flow | 2.3, 2.5 | 3.4 | 3.1, 3.3 |
| 3.3 | Add reliability + failure handling + log-write alerts | 2.4, 2.5 | 3.4 | 3.1, 3.2 |
| 3.4 | MVP validation test suite + launch checklist | 3.1, 3.2, 3.3 | 4.1+ | None |
| 4.1 | Add Telegram inline control UX | 3.4 | 4.3 | 4.2 |
| 4.2 | Improve stream presentation (progress cards/chunks) | 3.4 | 4.3 | 4.1 |
| 4.3 | Draft optional multi-session architecture (post-MVP) | 3.4 | None | 4.1, 4.2 |

### Parallel Execution Groups

**Wave 1** (start immediately):
- [x] Task 1.1
- [x] Task 1.2
- [x] Task 1.3
- [x] Task 1.5

**Wave 2** (after Wave 1 core):
- [x] Task 1.4 *(requires 1.1, 1.2)*
- [x] Task 2.4 *(requires 1.5)*
- [x] Task 2.3 *(requires 1.3)*
- [x] Task 2.5 *(requires 1.3)*

**Wave 3**:
- [x] Task 2.1 *(requires 1.4)*
- [x] Task 2.2 *(requires 1.4)*

**Wave 4**:
- [x] Task 3.1 *(requires 2.1, 2.2)*
- [x] Task 3.2 *(requires 2.3, 2.5)*
- [x] Task 3.3 *(requires 2.4, 2.5)*

**Wave 5**:
- [ ] Task 3.4 *(requires 3.1, 3.2, 3.3)*

### Critical Path

```text
1.1 → 1.4 → 2.2 → 3.1 → 3.4
```

**Critical Path Tasks**: 1.1, 1.4, 2.2, 3.1, 3.4  
**Estimated Length**: 5 major gated tasks

---

## Sprint 1: Proof of Concept (POC)

### Task 1.1: Define bot command contract and payload schema

**Description**: Specify command grammar (`/start_session`, `/send`, `/status`, `/stop`, `/new_session`) and input/output payload schema for the wrapper.

**Acceptance Criteria**:
- [x] Command schema documented with examples
- [x] Validation rules defined for invalid commands and missing args
- [x] Response envelope format defined for progress, logs, errors

**Dependencies**: None

**PRD Reference**: 3.1 F1, 4.1 Primary Flow, 8.1 MVP Scope

---

### Task 1.2: Implement Telegram transport skeleton

**Description**: Build Telegram integration layer (webhook or polling) with command receiver and outbound sender abstraction.

**Acceptance Criteria**:
- [x] Bot receives and parses commands from Telegram
- [x] Outbound sender can post text updates to chat
- [x] Basic retry/error handling for Telegram API failures

**Dependencies**: None

**PRD Reference**: 6.4 Integrations, 5.3 Compatibility

---

### Task 1.3: Implement Claude Code process adapter on macOS

**Description**: Build adapter to start/attach/send commands to local Claude Code terminal environment.

**Acceptance Criteria**:
- [x] Adapter can attach to authorized local Claude environment
- [x] Adapter supports send + receive output stream
- [x] Adapter returns structured process errors

**Dependencies**: None

**PRD Reference**: 6.2 Components (Session Manager), 5.2 Security

---

### Task 1.4: Build end-to-end POC routing loop

**Description**: Connect Telegram command input through process adapter and return response chunks (without final hardening yet).

**Acceptance Criteria**:
- [x] `/send` triggers Claude execution and returns output
- [x] `/status` reflects current runtime status
- [x] End-to-end flow works in local environment

**Dependencies**: Task 1.1, Task 1.2

**PRD Reference**: 4.1 Primary Flow, 8.1 MVP Scope

---

### Task 1.5: Define audit event schema and local storage policy

**Description**: Specify event format, file naming, and dedicated local path for per-session logs.

**Acceptance Criteria**:
- [x] JSONL event schema finalized
- [x] Session log path policy documented
- [x] Required event list mapped to schema fields

**Dependencies**: None

**PRD Reference**: 6.3 Storage and Paths, 7.2 Events

---

## Sprint 2: MVP Foundation

### Task 2.1: Implement single-concurrent-connection lock manager

**Description**: Add lock acquisition/release logic to allow only one active connection and reject second connection attempts.

**Acceptance Criteria**:
- [x] First connection acquires lock consistently
- [x] Second concurrent connection receives deterministic rejection
- [x] Lock recovery strategy exists for stale locks

**Dependencies**: Task 1.4

**PRD Reference**: 3.1 F2, 5.1 Lock check performance

---

### Task 2.2: Implement session lifecycle manager

**Description**: Build state machine for `/start_session`, `/stop`, `/new_session` with `/clear`-like behavior on active connection.

**Acceptance Criteria**:
- [x] `/new_session` resets Claude context without requiring new connection
- [x] `/stop` releases lock and terminates/cleans session
- [x] Session state transitions are logged and queryable

**Dependencies**: Task 1.4

**PRD Reference**: 4.2 Session Reset Flow, 3.1 F3

---

### Task 2.3: Build outbound sanitization pipeline

**Description**: Add outbound preprocessing stage before Telegram send to remove/mask sensitive data classes.

**Acceptance Criteria**:
- [x] All outbound chunks pass sanitizer stage
- [x] Sanitizer supports token/path/secret category handlers
- [x] Sanitizer failures block outbound send and raise alert

**Dependencies**: Task 1.3

**PRD Reference**: 3.1 F4, 5.2 Security

---

### Task 2.4: Implement per-session audit writer

**Description**: Persist structured event logs under dedicated local path with per-session files.

**Acceptance Criteria**:
- [x] Session log file created on session start
- [x] Commands/actions/errors append JSONL events
- [x] Log write failure is surfaced to operator

**Dependencies**: Task 1.5

**PRD Reference**: 3.1 F6, 6.3 Storage and Paths

---

### Task 2.5: Implement deterministic regex fallback masking

**Description**: Build regex ruleset to mask known secret/token/path patterns as secondary guardrail.

**Acceptance Criteria**:
- [x] Rules cover API keys, bearer tokens, password-like strings, sensitive local paths
- [x] Masking is applied after sanitizer stage
- [x] Unit tests cover false-positive/false-negative basics

**Dependencies**: Task 1.3

**PRD Reference**: 3.1 F5, 5.2 Security

---

## Sprint 3: MVP Completion

### Task 3.1: Enforce hard lock behavior across all command handlers

**Description**: Ensure every command path checks and respects the single concurrent connection policy.

**Acceptance Criteria**:
- [x] All handlers enforce lock ownership checks
- [x] Rejection responses include actionable guidance
- [x] Lock metrics/events included in audit logs

**Dependencies**: Task 2.1, Task 2.2

**PRD Reference**: 3.1 F2, 7.1 Lock conflict metric

---

### Task 3.2: Integrate sanitization + regex fallback into outbound send flow

**Description**: Finalize safe output pipeline in production path and validate no raw chunks bypass it.

**Acceptance Criteria**:
- [x] Outbound path is sanitizer-first then regex masking
- [x] No direct-send bypass exists in command handlers
- [x] Redaction events are traceable in logs

**Dependencies**: Task 2.3, Task 2.5

**PRD Reference**: 3.1 F4/F5, 7.3 Sanitizer failure alert

---

### Task 3.3: Add resilience and failure-handling controls

**Description**: Add retries/timeouts and alerting for session crash, audit write errors, and transport failures.

**Acceptance Criteria**:
- [x] Session crash detection + user notification implemented
- [x] Audit write failure triggers high-priority message
- [x] Retry policy implemented for Telegram transient failures

**Dependencies**: Task 2.4, Task 2.5

**PRD Reference**: 5.4 Reliability, 7.3 Alerts

---

### Task 3.4: Execute MVP validation suite and launch checklist

**Description**: Run integrated tests and checklist before declaring MVP ready.

**Acceptance Criteria**:
- [x] End-to-end tests pass for lifecycle and lock behavior
- [x] Security tests pass for outbound masking scenarios
- [x] MVP checklist in PRD section 8.1 is fully checked

**Dependencies**: Task 3.1, Task 3.2, Task 3.3

**PRD Reference**: 8.1 MVP Success Criteria

---

## Sprint 4: Feature Enhancement (Post-MVP)

### Task 4.1: Add Telegram inline control buttons

**Description**: Add callback controls for status/stop/new session actions.

**Acceptance Criteria**:
- [x] Buttons execute mapped commands
- [x] Permission/lock checks remain enforced
- [x] UI state feedback visible to user

**Dependencies**: Task 3.4

**PRD Reference**: 3.1 F8, 8.2 Post-MVP

---

### Task 4.2: Improve stream UX presentation

**Description**: Improve progress/log chunk formatting for readability and control.

**Acceptance Criteria**:
- [ ] Chunk format is compact and structured
- [ ] Progress updates are distinguishable from logs/errors
- [ ] User can request concise vs verbose mode

**Dependencies**: Task 3.4

**PRD Reference**: 7 Analytics & Monitoring (UX quality), 8.2 Post-MVP

---

### Task 4.3: Design optional multi-session architecture (future)

**Description**: Document isolation model and policy changes required before supporting multi-session.

**Acceptance Criteria**:
- [ ] Architecture decision record drafted
- [ ] Isolation and authz deltas documented
- [ ] Migration path from MVP lock model defined

**Dependencies**: Task 3.4

**PRD Reference**: 8.3 Future, 9 Risks

---

## Backlog: Future Iterations

### Multi-user role model
- Add operator/admin roles and per-chat policy scopes
- PRD reference: 8.3 Future (policy engine)

### Web dashboard
- Add lightweight observability dashboard for session logs
- PRD reference: 8.3 Future

### Supervisor integration
- Add robust process supervision strategy (launchd/system-managed)
- PRD reference: 9.1 Open Questions

---

## Ambiguous Requirements

| Requirement | What Needs Clarification |
|---|---|
| Trusted operator identity | Exact Telegram chat/user IDs to allow in MVP |
| Log retention | Retention duration and rotation policy for local session logs |
| Masking rule scope | Canonical list of secret/path patterns to treat as critical |
| Session reset semantics | Whether `/new_session` must preserve any memory/context |

---

## Technical Notes

- Prefer implementing lock and session manager as separate modules for testability.
- Treat outbound send as a single choke point so sanitizer coverage is enforceable.
- Include synthetic secret test corpus in CI to prevent masking regressions.
