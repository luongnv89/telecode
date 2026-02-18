# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-02-18

### Added

- **OpenCode backend support** — use [OpenCode](https://opencode.ai) as an alternative AI coding backend alongside Claude Code
- Pluggable `CodingAdapter` interface in `src/backends/types.ts` — makes adding new backends straightforward
- Backend factory (`src/backends/factory.ts`) to create adapters by type
- OpenCode adapter with SSE event streaming, sync fallback, and auto-server spawning
- OpenCode event parser for all SSE event types (text, tool, reasoning, session lifecycle, errors)
- `--backend=claude|opencode` flag on `/start_session` command
- `DEFAULT_BACKEND`, `OPENCODE_BASE_URL`, `OPENCODE_MODEL` environment variables
- Backend type shown in `/sessions` list and session start messages
- Persistence v2→v3 migration for backend type fields
- 62 new tests for OpenCode event parser, adapter, and backend factory (606 total across 32 suites)

## [0.1.0] - 2025-02-15

### Added

- Telegram bot with grammy framework
- Claude Code integration via `@anthropic-ai/claude-agent-sdk`
- Multi-session management (up to 5 concurrent sessions)
- Session focus tracking and switching
- Session bookmarks for quick directory access
- Permission bridge — route SDK tool approvals through Telegram inline buttons
- Two-stage outbound sanitization (category-based + regex masking)
- Per-session JSONL audit logging
- Resilience monitor with stale session detection and crash notifications
- User allowlist authentication
- Typing indicator while Claude Code is working
- Telegram command menu registration
- Detailed tool activity in progress messages
- One-line install script with optional LaunchAgent service
- 544 tests across 29 test suites
