# Configuration Reference

All configuration is provided via environment variables. Create a `.env` file in the project root or set them in your shell.

## Environment Variables

### Required

| Variable | Type | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | string | Telegram Bot API token from [@BotFather](https://t.me/BotFather) |
| `ALLOWED_USER_IDS` | string | Comma-separated list of authorized Telegram user IDs (e.g., `123456,789012`) |

### Optional

| Variable | Type | Default | Description |
|---|---|---|---|
| `LOG_PATH` | string | *platform default (see below)* | Directory for per-session audit log files |
| `CLAUDE_MODEL` | string | *(SDK default)* | Claude model to use for sessions |
| `SESSION_TIMEOUT_MS` | number | `1800000` (30 min) | Session inactivity timeout in milliseconds |
| `MAX_SESSIONS` | number | `5` | Maximum concurrent sessions (1-10) |
| `SESSIONS_FILE_PATH` | string | *platform default (see below)* | Path for session persistence file |
| `BOOKMARKS_FILE_PATH` | string | *platform default (see below)* | Path for bookmarks file |
| `DEFAULT_DISPLAY_MODE` | `concise` \| `verbose` | `concise` | Default progress display mode for new users |
| `PERMISSION_TIMEOUT_MS` | number | `60000` (60s) | Timeout for tool permission requests before auto-deny |
| `DEFAULT_BACKEND` | `claude` \| `opencode` | `claude` | Default AI backend for new sessions |
| `OPENCODE_BASE_URL` | string | `http://localhost:4096` | OpenCode server URL (only used when backend is `opencode`) |
| `OPENCODE_MODEL` | string | *(server default)* | Model for OpenCode sessions (e.g., `anthropic/claude-sonnet-4-20250514`) |

## Example `.env`

```env
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
ALLOWED_USER_IDS=123456789,987654321
LOG_PATH=/var/log/telecode
SESSION_TIMEOUT_MS=3600000
MAX_SESSIONS=3
DEFAULT_DISPLAY_MODE=verbose
PERMISSION_TIMEOUT_MS=120000

# OpenCode backend (optional — only needed if you use --backend=opencode)
DEFAULT_BACKEND=claude
OPENCODE_BASE_URL=http://localhost:4096
OPENCODE_MODEL=anthropic/claude-sonnet-4-20250514
```

## Validation

Configuration is validated at startup using Zod schemas (`src/config.ts`). Invalid values produce clear error messages and prevent the bot from starting.

Validation rules:
- `TELEGRAM_BOT_TOKEN` must be a non-empty string
- `ALLOWED_USER_IDS` must parse to an array of positive integers
- `SESSION_TIMEOUT_MS` must parse to a positive integer
- `MAX_SESSIONS` must parse to a positive integer between 1 and 10
- `DEFAULT_DISPLAY_MODE` must be `concise` or `verbose`
- `PERMISSION_TIMEOUT_MS` must parse to a positive integer
- `DEFAULT_BACKEND` must be `claude` or `opencode`

## Data Paths

Default paths are platform-specific:

**macOS:**
```
~/Library/Application Support/telecode/
├── logs/                    # Per-session JSONL audit logs
│   └── session-YYYYMMDD-HHMMSS-<id>.jsonl
├── sessions.json            # Persisted session state
└── bookmarks.json           # Saved directory bookmarks
```

**Linux** (follows the [XDG Base Directory spec](https://specifications.freedesktop.org/basedir-spec/latest/)):
```
~/.local/share/telecode/
├── logs/                    # Per-session JSONL audit logs
│   └── session-YYYYMMDD-HHMMSS-<id>.jsonl
├── sessions.json            # Persisted session state
└── bookmarks.json           # Saved directory bookmarks
```

On Linux, `XDG_DATA_HOME` is respected if set (defaults to `~/.local/share`).
