# Troubleshooting

## Startup Errors

### `Invalid configuration: telegramBotToken: TELEGRAM_BOT_TOKEN is required`

The bot token is missing or empty. Ensure your `.env` file contains:
```env
TELEGRAM_BOT_TOKEN=your-token-here
```

### `Invalid configuration: allowedUserIds: ALLOWED_USER_IDS is required`

Set at least one authorized Telegram user ID:
```env
ALLOWED_USER_IDS=123456789
```

To find your user ID, message [@userinfobot](https://t.me/userinfobot) on Telegram.

### `MAX_SESSIONS` validation error

`MAX_SESSIONS` must be a number between 1 and 10.

## Bot Not Responding

### Silent rejection (no response at all)

Your Telegram user ID is not in `ALLOWED_USER_IDS`. This is intentional — unauthorized users get no response to prevent bot discovery.

### Bot responds but commands fail

Check that Claude Code is installed and authenticated on the host machine. Telecode requires a working local Claude Code environment.

## Session Issues

### `No focused session. Use /start_session to create one.`

No session is active. Start one with:
```
/start_session
```
Or with a specific directory:
```
/start_session ~/projects/myapp
```

### `Session is owned by another connection.`

Another user/chat pair holds the lock on this session. Only the lock owner can send commands. Wait for them to `/stop` or for the session timeout to expire (default: 30 minutes).

### `Working directory does not exist`

The specified path doesn't exist on the host machine. Verify the path:
```
/start_session /correct/path/here
```

### Session seems stuck (no response to prompts)

The Claude session may have timed out or crashed. Try:
1. `/status` to check session state
2. `/new_session` to reset Claude context
3. `/stop` then `/start_session` to start fresh

## Output Issues

### `Output was blocked by the safety filter. Check server logs.`

The sanitization pipeline failed to process the output. This is a protective measure — no unsanitized content reaches Telegram. Check the server console logs for details.

### Responses seem truncated

Telegram messages have a 4096-character limit. Long responses are automatically truncated with a `... (truncated)` notice.

## Inline Buttons

### Buttons stop working after a while

If the session state changed since the message was sent (e.g., session was stopped), clicking a button will return the appropriate error. Start a new session.

### No buttons appear on messages

Inline buttons only appear on specific response types: session start, prompt results, status, new session, and session list. Error responses and stop confirmations do not include buttons.

## Permission Requests

### Permission request timed out

If you see "Permission request timed out", Claude was waiting for your approval to use a tool but you didn't respond in time. The timeout is controlled by `PERMISSION_TIMEOUT_MS` (default: 60 seconds). Increase it if you need more time:
```env
PERMISSION_TIMEOUT_MS=120000
```

### No permission buttons appearing

Permission buttons only appear when Claude Code requests tool approval via the SDK's `canUseTool` callback. If you're running with `allowedTools` configured to auto-approve certain tools, those won't show permission prompts.

### "No focused session — permission request ignored"

You clicked a permission button but don't have a focused session. This can happen if the session was stopped while a permission request was pending.

## Audit Logs

### Log files not appearing

Check the log directory exists and is writable:
```bash
ls -la ~/Library/Application\ Support/telecode/logs/
```

If using a custom `LOG_PATH`, verify the directory exists.

### How to read audit logs

Audit logs are JSONL files (one JSON object per line):
```bash
cat ~/Library/Application\ Support/telecode/logs/session-*.jsonl | jq .
```
