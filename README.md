<p align="center">
  <img src="assets/logo/logo-full.svg" alt="Telecode" width="520" />
</p>

<p align="center">
  <strong>Code from anywhere.</strong><br/><br/>
  Telegram bot that wraps Claude Code for remote macOS control.<br/>
  Send prompts, manage sessions, and receive sanitized responses — all from your phone.
</p>

## Quickstart

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your Telegram bot token and user IDs

# 3. Run
npm run dev
```

### Required Environment Variables

| Variable | Description |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Bot token from [@BotFather](https://t.me/BotFather) |
| `ALLOWED_USER_IDS` | Comma-separated Telegram user IDs |

See [Configuration Reference](docs/configuration.md) for all options.

## Commands

| Command | Description |
|---|---|
| `/start_session [path] [name]` | Start a new Claude Code session |
| `/stop` | Stop the focused session |
| `/status` | Check session status |
| `/new_session` | Reset Claude context (fresh conversation) |
| `/sessions` | List all active sessions |
| `/switch <target>` | Switch focus to another session |
| Send any text | Forward as a prompt to Claude |

See [Command Reference](docs/commands.md) for all 20+ commands.

## Architecture

```
Telegram  -->  Auth  -->  Router  -->  Handlers  -->  Claude Code
                                          |
                                    Sanitization
                                          |
                                     Audit Log
```

Telecode enforces a strict security pipeline: all outbound text passes through category-based sanitization and regex masking before reaching Telegram. Per-session audit logs capture every command and output event.

See [Architecture](docs/architecture.md) for the full system design.

## Documentation

| Document | Description |
|---|---|
| [Architecture](docs/architecture.md) | System design, module overview, data flow |
| [Commands](docs/commands.md) | Full command reference with examples |
| [Configuration](docs/configuration.md) | Environment variables and defaults |
| [Development](docs/development.md) | Local setup, testing, project conventions |
| [Security](docs/security.md) | Sanitization pipeline, auth, lock model |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and solutions |

## Planning Documents

| Document | Description |
|---|---|
| [Idea](idea.md) | Original concept and clarifications |
| [Validation](validate.md) | Feasibility analysis |
| [PRD](prd.md) | Product Requirements Document |
| [Tasks](tasks.md) | Sprint-based development task breakdown |

## License

Private project.
