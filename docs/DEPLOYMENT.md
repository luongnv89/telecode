# Deployment

## Quick Install

One-line install script:

```bash
curl -fsSL https://raw.githubusercontent.com/luongnv89/telecode/main/install.sh | bash
```

To install and run as a service (auto-start on login):

```bash
curl -fsSL https://raw.githubusercontent.com/luongnv89/telecode/main/install.sh | bash -s -- --service
```

## Manual Setup

### 1. Clone and Build

```bash
git clone https://github.com/luongnv89/telecode.git
cd telecode
npm install
npm run build
```

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

| Variable | Required | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Yes | Bot token from [@BotFather](https://t.me/BotFather) |
| `ALLOWED_USER_IDS` | Yes | Comma-separated Telegram user IDs |
| `CLAUDE_MODEL` | No | Claude model override |
| `SESSION_TIMEOUT_MS` | No | Session timeout (default: 30 minutes) |
| `MAX_SESSIONS` | No | Max concurrent sessions (default: 5) |
| `LOG_PATH` | No | Audit log directory |
| `DEFAULT_DISPLAY_MODE` | No | Progress display mode (`concise` or `verbose`) |
| `PERMISSION_TIMEOUT_MS` | No | Permission request timeout (default: 60s) |

See [Configuration Reference](configuration.md) for all options.

### 3. Run

**Development:**
```bash
npm run dev
```

**Production:**
```bash
npm run build
node dist/index.js
```

## macOS LaunchAgent (Auto-Start)

The install script with `--service` creates a LaunchAgent at:
```
~/Library/LaunchAgents/com.telecode.bot.plist
```

Manual service management:
```bash
# Start
launchctl load ~/Library/LaunchAgents/com.telecode.bot.plist

# Stop
launchctl unload ~/Library/LaunchAgents/com.telecode.bot.plist

# Check status
launchctl list | grep telecode
```

## Prerequisites

- **macOS** (Claude Code requirement)
- **Node.js** 18+
- **Claude Code** installed and authenticated (`claude --version`)
- A Telegram bot token from [@BotFather](https://t.me/BotFather)

## Health Checks

Telecode includes a built-in resilience monitor that detects:
- Stale sessions (no activity within timeout)
- Claude Code process crashes
- Audit write failures

Alerts are sent to the Telegram chat automatically.
