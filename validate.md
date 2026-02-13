# Validation: Claude Code Telegram Remote Wrapper

## Quick Verdict
**Build it**

## Why
The pain is real (remote control + mobile-first operation for coding tasks), and the core MVP is technically feasible with clear boundaries. The biggest challenge is not implementation complexity; it is secure execution and safe observability.

## Updated Inputs
- Stack candidate: Rust
- Timeline: no limit
- Budget: no limit
- Constraints remain: macOS host availability, Telegram Bot API limits, secure command execution/log redaction, single-concurrent-connection MVP.

## Similar Products
- Terminal-over-chat automations (custom bot + tmux patterns)
- ChatOps bots in Slack/Discord for CI/ops triggers
- Remote coding control via SSH + scripts

## Differentiation
- Purpose-built bridge for Claude Code session control
- Telegram-first interactive workflow with streaming progress and logs
- Session-aware controls (start/attach/stop/resume) instead of stateless commands

## Strengths
- Strong utility for remote workflows
- Clear MVP scope (session control + prompt bridge + log streaming)
- Fast path to usable prototype on a single trusted host

## Concerns
- Security still depends on host trust boundary (if Mac is compromised, bot control is compromised)
- Outbound sanitization can still miss edge-case secrets without strong deterministic masking rules/tests
- Session contention is deferred by design (MVP supports one concurrent connection only)

## Ratings
- Creativity: 8/10
- Feasibility: 8/10
- Market Impact: 7/10
- Technical Execution: 7/10

## How to Strengthen
- Enforce hard lock on concurrent connections (reject second connection attempts), but allow active user to reset/start new Claude session (/clear-like flow)
- Reuse existing authorized Claude Code environment on Mac (no separate auth/permission setup in MVP)
- Move sensitive-data handling to outbound response preparation (no wrapper text added into user prompts)
- Add lightweight deterministic fallback masking (regex-based) before posting to Telegram
- Add audit logs for every remote session/action in a dedicated local Mac directory

## Enhanced Version
A secure remote-agent gateway with:
1) single trusted operator + single concurrent connection in MVP,
2) reuse of already-authorized Claude Code environment on Mac,
3) real-time event stream (status/progress/log chunks),
4) transport-layer redaction/masking pipeline for outbound Telegram payloads,
5) resumable/resettable Claude sessions and failure recovery on the same host.

## Implementation Roadmap
### Phase 1 (MVP, 1-2 weeks)
- Telegram bot command set: /start_session, /send, /status, /stop, /new_session (or /clear-like)
- Local wrapper process to attach to already-authorized Claude Code environment on Mac
- Enforce single concurrent connection lock (reject second connection)
- Implement outbound sanitization before Telegram send (no prompt-wrapper injection)

### Phase 2 (Hardening)
- Deterministic fallback masking before Telegram output (tokens/secrets/path patterns)
- Dedicated per-session audit logs in local Mac directory (e.g., `~/Library/Application Support/claude-telegram-wrapper/logs/`)
- Trusted chat/user allowlist
- Session timeout, retries, and health checks

### Phase 3 (Scale UX)
- Interactive controls (buttons for pause/resume/stop)
- Optional multi-session support (only after policy + isolation are mature)
- Lightweight web dashboard for session state/history
