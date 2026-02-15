# Security Model

## Overview

Telecode runs Claude Code on a local macOS machine and sends output over Telegram. The security model addresses three concerns:

1. **Authentication**: Only authorized users can interact with the bot
2. **Authorization**: Per-session locks prevent concurrent access conflicts
3. **Output safety**: All outbound text is sanitized before reaching Telegram

## Authentication

### User Allowlist

The `ALLOWED_USER_IDS` environment variable defines a comma-separated list of Telegram user IDs permitted to use the bot.

```
ALLOWED_USER_IDS=123456789,987654321
```

The auth middleware (`src/telegram/middleware/auth.ts`) checks every incoming update against this allowlist. Unauthorized users receive **silent rejection** — no response is sent, preventing bot discovery by unauthorized parties.

The allowlist applies to both text commands and inline button callbacks (grammy provides `ctx.from` on all update types).

## Lock Manager

Each session has a dedicated lock manager (`src/lock/manager.ts`) enforcing single-concurrent-connection policy:

- **Acquire**: A user/chat pair acquires the lock when creating or attaching to a session
- **Release**: Lock is released on `/stop` or session removal
- **Ownership check**: Every command that modifies session state verifies lock ownership
- **Reacquire**: The same user/chat can reacquire their own lock (reconnection)
- **Stale detection**: Locks have a TTL (`SESSION_TIMEOUT_MS`). Stale locks are automatically released by the resilience monitor

If a second user tries to interact with a locked session, they receive:
```
Error [SESSION_LOCKED]: Session is owned by another connection.
```

## Output Sanitization

All outbound text passes through a two-stage pipeline before reaching Telegram. No handler can bypass this — the `SafeSender` wrapper is the only send path.

### Stage 1: Category-Based Sanitization (`src/sanitize/pipeline.ts`)

Detects and redacts sensitive content by category:
- API keys and tokens
- File paths containing sensitive directories
- Secret patterns (passwords, credentials)

Returns a redaction count for audit logging.

### Stage 2: Regex Fallback Masking (`src/sanitize/regex-masking.ts`)

Deterministic regex rules as a defense-in-depth layer:

| Pattern | Replacement |
|---|---|
| API keys (`sk-...`, `key-...`) | `***API_KEY***` |
| Bearer tokens | `***BEARER_TOKEN***` |
| Password-like strings | `***PASSWORD***` |
| AWS keys | `***AWS_KEY***` |
| SSH private keys | `***PRIVATE_KEY***` |
| Database connection strings | `***DB_CONNECTION***` |

### Failure Mode

If either sanitization stage throws an exception:
1. The outbound message is **blocked entirely**
2. A generic error is sent: "Output was blocked by the safety filter"
3. An `error_occurred` audit event is logged with code `SANITIZE_FAILURE`
4. The `onSanitizeFailure` callback is invoked for alerting

## Audit Trail

Every session produces a JSONL audit log file capturing:

| Event | Description |
|---|---|
| `session_started` | Session created |
| `session_stopped` | Session terminated |
| `session_reset` | Claude context cleared |
| `command_received` | Command processed (includes raw text) |
| `output_sanitized` | Redactions applied (includes count) |
| `output_delivered` | Response sent (includes char count) |
| `lock_acquired` | Lock taken |
| `lock_released` | Lock released |
| `lock_stale_released` | Stale lock auto-released |
| `lock_rejected` | Lock denied (includes holder info) |
| `error_occurred` | Error (includes code and message) |

Log files are stored at `~/Library/Application Support/telecode/logs/` by default (configurable via `LOG_PATH`).

## Permission Bridge

When Claude Code requests permission to use a tool (via the SDK's `canUseTool` callback), the permission bridge (`src/telegram/permission-bridge.ts`) sends an inline message to the user with Allow, Deny, and Always Allow buttons.

Security properties:

- **Per-request IDs**: Each permission request gets a unique 8-character ID, preventing replay or cross-request interference
- **Timeout enforcement**: Requests auto-deny after `PERMISSION_TIMEOUT_MS` (default: 60s) if the user doesn't respond
- **Abort signal support**: If the SDK aborts the operation, the pending permission is immediately cancelled with deny+interrupt
- **Send failure fallback**: If the Telegram message can't be delivered, the request auto-denies
- **Session cleanup**: When a session is stopped, all pending permission requests are cancelled via `cancelAll()`
- **Focused session scoping**: Permission callbacks are resolved only against the user's currently focused session

## Inline Button Security

Inline keyboard button clicks go through the same security pipeline as text commands:

1. **Auth**: `ctx.from.id` is checked by the auth middleware
2. **Lock**: The callback handler creates a `ValidatedCommand` and routes to the same handler functions that enforce lock ownership
3. **Sanitization**: Responses are sent through `SafeSender`
4. **Audit**: Button-triggered commands appear in audit logs with `rawText: "[button:action]"`
