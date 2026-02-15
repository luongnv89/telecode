# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

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
