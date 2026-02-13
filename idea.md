# Idea: Claude Code Telegram Remote Wrapper

## Original Concept
Create a wrapper/middle layer to use Claude Code (on macOS) remotely via a Telegram Bot.

Desired capabilities:
- Trigger opening a Claude Code session
- Middle layer sends prompts to Claude Code
- Return progress/log updates to user in an interactive way

## Clarified Understanding
A ChatOps-style control plane where Telegram is the remote UI and Claude Code runs on a trusted Mac host. The wrapper should bridge input/output, stream progress safely, and support interactive session control.

Updated direction:
- Reuse the already authorized Claude Code environment on the Mac host (same auth/permission/local setup as when user opens terminal directly).
- Do sensitive-data handling in the outbound response pipeline (before sending to Telegram), not by adding wrapper text into user prompts.
- Enforce single concurrent connection in MVP (reject second concurrent connection), while allowing the connected user to reset/start a fresh Claude Code session ("/clear-like" behavior).

## Target Audience
- Solo builders and small engineering teams
- Users who run Claude Code on a dedicated Mac and need remote/mobile control
- Power users who want “ops from chat” without opening terminal/desktop directly

## Goals & Objectives
- Start and manage Claude Code sessions remotely from Telegram
- Send prompt/tasks and receive structured progress + logs
- Keep sessions recoverable and secure (hard connection lock + output redaction + audit trail)
- Reduce friction for remote coding/ops workflows

## Technical Context
- Stack: Rust? (candidate)
- Timeline: no limit
- Budget: no limit
- Constraints:
  - macOS host availability
  - Telegram Bot API constraints
  - Secure remote command execution and log redaction
  - MVP is intentionally single-concurrent-connection only (but supports session reset/new session by the active user)

## Discussion Notes
- Core interaction should be “interactive”, not one-shot request/response.
- Session lifecycle UX matters: start, attach, stream, stop, resume.
- Security is first-class (who can trigger what, and how to prevent misuse).
- For MVP, trust boundary is the Mac machine itself (Claude Code already authenticated and configured there).
- Telegram replies should come from Claude Code terminal output after outbound sanitization/redaction in transport layer (not prompt wrapper injection).
- Concurrency is explicitly out of scope in MVP: allow only one active connection at a time, but allow reset/new Claude session for that connection.
