# Command Reference

## Session Management

### `/start_session [path] [name]`

Start a new Claude Code session.

- `path` (optional): Working directory. Defaults to the server's current directory.
- `name` (optional): Human-readable session name.

```
/start_session ~/projects/myapp backend
```

Returns: Session ID, working directory, active session count. Includes inline buttons.

### `/stop`

Stop the currently focused session. Releases the lock and removes the session.

### `/new_session`

Reset the focused session's Claude context (like `/clear` in Claude Code). Creates a new Claude conversation while keeping the same working directory and lock.

### `/status`

Show focused session status: active/inactive, session ID, state, uptime, lock info.

### `/sessions`

List all active sessions with their IDs, names, working directories, and states. The focused session is marked with `>`.

### `/switch <target>`

Switch focus to a different session by name or ID prefix.

```
/switch backend
/switch a1b2c3d4
```

### `/remove <target>`

Remove a session by name or ID prefix. Only the lock owner can remove a session.

## Prompt Sending

### Plain text (no `/` prefix)

Any message without a leading `/` is forwarded to the focused Claude Code session as a prompt.

```
explain the authentication flow in this codebase
```

Returns: Claude's response with inline buttons (Status, Stop, New Session).

## Navigation

### `/cd <path>`

Switch to a directory. If a session already exists for that path, focuses it. Otherwise creates a new session.

```
/cd ~/projects/other-app
```

### `/goto <target>`

Jump to a session by name, ID prefix, or list index (1-based).

```
/goto 2
/goto backend
```

### `/back`

Return to the previously focused session (history stack).

### `/resume [target]`

Resume a session by name/ID, or resume the most recent session if no target given.

## Bookmarks

### `/bookmark <name> <path>`

Save a directory as a named bookmark.

```
/bookmark myapp ~/projects/myapp
```

### `/bookmarks`

List all saved bookmarks.

### `/open <name>`

Open a bookmark — starts or switches to a session in the bookmarked directory.

### `/unbookmark <name>`

Remove a saved bookmark.

## Session Discovery

### `/discover`

Scan the local machine for running Claude Code sessions (reads session socket files).

### `/attach <target>`

Attach to a discovered session by index (from `/discover` output) or session ID prefix.

```
/attach 1
/attach a1b2c3d4
```

## Claude Code Commands

### `/cc_clear`

Send `/clear` to the focused Claude session (clear conversation history).

### `/cc_compact`

Send `/compact` to the focused Claude session (compress context).

### `/cc_context`

Send `/context` to the focused Claude session (show context info).

### `/cc_resume`

Send `/resume` to the focused Claude session (resume previous conversation).

## Display & Info

### `/verbose`

Switch to verbose progress display. Shows detailed update counts, character counts, recent tool activity, and last output preview during Claude execution.

### `/concise`

Switch to concise progress display (default). Shows a compact working indicator with elapsed time and recent tool activity.

### `/version`

Show the current Telecode version.

## Inline Buttons

Certain responses include inline keyboard buttons for quick actions:

| Button | Action | Shown on |
|---|---|---|
| **Status** | Check session status | Session start, prompt results, session list |
| **Stop** | Stop focused session | Session start, prompt results, session list, status, new session |
| **New Session** | Reset Claude context | Session start, prompt results, session list, status, new session |

Buttons trigger the same handlers as text commands, with full auth and lock enforcement.

## Permission Buttons

When Claude Code requests permission to use a tool (e.g., running a shell command), Telecode sends an inline message with three options:

| Button | Action |
|---|---|
| **Allow** | Approve this specific tool use |
| **Deny** | Reject this tool use (interrupts the current operation) |
| **Always Allow** | Approve and add a persistent permission rule for the session |

Permission requests time out after `PERMISSION_TIMEOUT_MS` (default: 60 seconds), auto-denying if no response is given.
