# Development Guide

## Prerequisites

- **Node.js** 18+ (ES2022 target)
- **macOS** (Claude Code runs locally)
- **Claude Code** installed and authenticated
- A Telegram bot token from [@BotFather](https://t.me/BotFather)

## Setup

```bash
# Clone and install
git clone <repo-url>
cd telecode
npm install

# Configure
cp .env.example .env
# Edit .env — see docs/configuration.md

# Run in development mode (with tsx hot-reload)
npm run dev
```

## Scripts

| Script | Command | Description |
|---|---|---|
| `npm run dev` | `tsx src/index.ts` | Run with hot-reload |
| `npm run build` | `tsc` | Compile TypeScript to `dist/` |
| `npm test` | `vitest run` | Run all tests once |
| `npm run test:watch` | `vitest` | Run tests in watch mode |
| `npm run typecheck` | `tsc --noEmit` | Type-check without emitting |

## Project Structure

```
src/
├── index.ts              # Entry point — bootstrap and start
├── config.ts             # Zod-validated environment config
├── version.ts            # Version string constant
├── telegram/             # Telegram bot integration
│   ├── bot.ts            # Bot factory and wiring
│   ├── sender.ts         # Message sending with retry
│   ├── keyboards.ts      # Inline keyboard builders
│   ├── permission-bridge.ts  # SDK canUseTool ↔ Telegram inline buttons
│   ├── progress-streamer.ts  # Typing indicator and progress updates
│   ├── user-preferences.ts   # Per-user display mode (concise/verbose)
│   ├── commands/
│   │   ├── router.ts     # Command parsing and routing
│   │   ├── handlers.ts   # All command implementations
│   │   └── callbacks.ts  # Inline button handlers (actions + permissions)
│   └── middleware/
│       └── auth.ts       # User allowlist check
├── session/              # Multi-session management
│   ├── registry.ts       # Session container
│   ├── focus-manager.ts  # Active session tracking
│   ├── state-machine.ts  # Session state transitions
│   ├── persistence.ts    # Save/restore to disk
│   ├── discovery.ts      # Find running Claude sessions
│   └── bookmarks.ts      # Directory shortcuts
├── lock/
│   └── manager.ts        # Per-session connection lock
├── claude/               # Claude Code bridge
│   ├── adapter.ts        # SDK wrapper (passes canUseTool for permission bridge)
│   ├── session-manager.ts
│   └── message-parser.ts
├── sanitize/             # Output safety
│   ├── pipeline.ts       # Category-based sanitization
│   ├── regex-masking.ts  # Regex fallback masking
│   └── outbound.ts       # Safe sender wrapper
├── audit/                # Event logging
│   ├── writer.ts         # JSONL file writer
│   ├── schema.ts         # Event type definitions
│   └── paths.ts          # Log directory management
├── resilience/
│   └── monitor.ts        # Health checks and failure recovery
└── types/                # Shared TypeScript contracts
    ├── commands.ts
    ├── session.ts
    ├── envelope.ts
    ├── audit.ts
    ├── errors.ts
    └── index.ts
```

## Testing

Tests live in `tests/` mirroring the `src/` directory structure. Uses [Vitest](https://vitest.dev/).

```bash
# Run all tests
npm test

# Run specific test file
npx vitest run tests/telegram/keyboards.test.ts

# Run tests matching a pattern
npx vitest run -t "inline button"

# Watch mode
npm run test:watch
```

### Test Categories

| Directory | Scope |
|---|---|
| `tests/telegram/` | Bot, sender, router, handlers, auth, keyboards, callbacks |
| `tests/session/` | Bookmarks, discovery, state machine |
| `tests/claude/` | Adapter, session manager, message parser |
| `tests/lock/` | Lock manager |
| `tests/sanitize/` | Pipeline, regex masking, outbound sender |
| `tests/audit/` | Writer, schema, paths, integration |
| `tests/resilience/` | Monitor |
| `tests/types/` | Command parsing |
| `tests/e2e/` | Full lifecycle, security, MVP checklist, inline buttons |

## Conventions

- **ES Modules**: All imports use `.js` extensions (TypeScript with Node16 module resolution)
- **Strict TypeScript**: `strict: true` in tsconfig
- **No classes for services**: Most modules export factory functions (`createXxx()`)
- **Response envelopes**: All handler responses use typed `ResponseEnvelope` unions
- **Safe sender**: All outbound text goes through `SafeSender` — never call `bot.api.sendMessage()` directly in handlers

## Adding a New Command

1. Add the command type to the `BotCommand` union in `src/types/commands.ts`
2. Add parsing logic in `parseCommand()` in the same file
3. Add the handler name to `CommandHandlers` interface in `src/telegram/commands/router.ts`
4. Implement the handler in `src/telegram/commands/handlers.ts`
5. Add tests in `tests/telegram/handlers.test.ts` and `tests/types/commands.test.ts`
