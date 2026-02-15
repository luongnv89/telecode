# Contributing to Telecode

Thank you for your interest in contributing to Telecode! This guide will help you get started.

## How to Contribute

1. **Fork** the repository
2. **Create** a feature branch from `main` (`git checkout -b feat/your-feature`)
3. **Make** your changes
4. **Test** your changes (`npm test`)
5. **Commit** using [Conventional Commits](#commit-conventions)
6. **Push** to your fork and open a Pull Request

## Development Setup

### Prerequisites

- **Node.js** 18+
- **macOS** (Claude Code runs locally)
- **Claude Code** installed and authenticated
- A Telegram bot token from [@BotFather](https://t.me/BotFather)

### Getting Started

```bash
git clone https://github.com/luongnv89/telecode.git
cd telecode
npm install

cp .env.example .env
# Edit .env with your credentials

npm run dev
```

### Scripts

| Script | Description |
|---|---|
| `npm run dev` | Run with hot-reload (tsx) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm test` | Run all tests once |
| `npm run test:watch` | Run tests in watch mode |
| `npm run typecheck` | Type-check without emitting |

## Branching Strategy

- `main` — stable, production-ready code
- `feat/*` — new features
- `fix/*` — bug fixes
- `docs/*` — documentation changes
- `refactor/*` — code refactoring

Always branch from `main` and submit PRs back to `main`.

## Commit Conventions

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <description>

[optional body]
```

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `build`, `ci`

**Examples:**
```
feat: add session bookmarking support
fix: prevent race condition in lock manager
docs: update configuration reference
test: add missing tests for sanitization pipeline
```

## Pull Request Process

1. Ensure all tests pass (`npm test`)
2. Ensure type-checking passes (`npm run typecheck`)
3. Update documentation if your changes affect user-facing behavior
4. Fill out the PR template completely
5. Request review from a maintainer

PRs require at least one approving review before merge.

## Coding Standards

- **ES Modules** — all imports use `.js` extensions (TypeScript with Node16 module resolution)
- **Strict TypeScript** — `strict: true` in tsconfig
- **Factory functions** — prefer `createXxx()` over classes for services
- **Response envelopes** — all handler responses use typed `ResponseEnvelope` unions
- **Safe sender** — all outbound text must go through `SafeSender`, never call `bot.api.sendMessage()` directly
- **No secrets in code** — use environment variables for sensitive configuration

## Testing Requirements

- All new features must include tests
- All bug fixes should include a regression test
- Tests live in `tests/` mirroring the `src/` directory structure
- Use [Vitest](https://vitest.dev/) for all tests

## Adding a New Command

1. Add the command type to `BotCommand` union in `src/types/commands.ts`
2. Add parsing logic in `parseCommand()` in the same file
3. Add the handler name to `CommandHandlers` interface in `src/telegram/commands/router.ts`
4. Implement the handler in `src/telegram/commands/handlers.ts`
5. Add tests in `tests/telegram/handlers.test.ts` and `tests/types/commands.test.ts`

## Questions?

Open a [GitHub Discussion](https://github.com/luongnv89/telecode/discussions) or file an issue.
