#!/usr/bin/env bash
# ==============================================================================
# TeleCode — macOS Installation Script
# Installs TeleCode and optionally registers it as a LaunchAgent service
# that starts automatically on login and stays running.
# ==============================================================================
set -euo pipefail

# ── Colors & helpers ─────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()    { printf "${BLUE}[info]${NC}    %s\n" "$*"; }
success() { printf "${GREEN}[ok]${NC}      %s\n" "$*"; }
warn()    { printf "${YELLOW}[warn]${NC}    %s\n" "$*"; }
error()   { printf "${RED}[error]${NC}   %s\n" "$*"; }
step()    { printf "\n${BOLD}${CYAN}==> %s${NC}\n" "$*"; }

# ── Constants ────────────────────────────────────────────────────────────────
PLIST_LABEL="com.telecode.bot"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"
APP_DATA_DIR="$HOME/Library/Application Support/telecode"
LOG_DIR="$HOME/Library/Logs/telecode"
MIN_NODE_VERSION=18
INSTALL_DIR="${INSTALL_DIR:-$HOME/.telecode}"
REPO_URL="https://github.com/luongnv89/telecode.git"

# Detect local vs remote execution
# When piped from curl, BASH_SOURCE[0] is empty — use this to distinguish modes.
_SELF="${BASH_SOURCE[0]:-}"
if [ -n "$_SELF" ] && [ -f "$_SELF" ]; then
    SCRIPT_DIR="$(cd "$(dirname "$_SELF")" && pwd)"
    if [ -f "$SCRIPT_DIR/package.json" ]; then
        PROJECT_DIR="$SCRIPT_DIR"
        REMOTE_INSTALL=false
    else
        REMOTE_INSTALL=true
        PROJECT_DIR=""
    fi
else
    REMOTE_INSTALL=true
    # PROJECT_DIR set after clone in the download step below
    PROJECT_DIR=""
fi
unset _SELF

# ── Parse arguments ──────────────────────────────────────────────────────────
INSTALL_SERVICE=false
UNINSTALL=false

usage() {
    cat <<EOF
${BOLD}TeleCode Installer for macOS${NC}

Usage: install.sh [OPTIONS]

Options:
  --service       Install as a LaunchAgent service (auto-start on login)
  --uninstall     Remove the LaunchAgent service
  -h, --help      Show this help message

Examples:
  install.sh                  # Install dependencies and build only
  install.sh --service        # Install + register as auto-start service
  install.sh --uninstall      # Remove the service (keeps files)

Remote install:
  curl -fsSL https://raw.githubusercontent.com/luongnv89/telecode/main/install.sh | bash
  curl -fsSL ... | bash -s -- --service
EOF
    exit 0
}

for arg in "$@"; do
    case "$arg" in
        --service)   INSTALL_SERVICE=true ;;
        --uninstall) UNINSTALL=true ;;
        -h|--help)   usage ;;
        *) error "Unknown option: $arg"; usage ;;
    esac
done

# ── Uninstall path ───────────────────────────────────────────────────────────
if $UNINSTALL; then
    step "Uninstalling TeleCode service"

    if launchctl list 2>/dev/null | grep -q "$PLIST_LABEL"; then
        info "Stopping service..."
        launchctl bootout "gui/$(id -u)/$PLIST_LABEL" 2>/dev/null || true
        success "Service stopped"
    else
        info "Service is not running"
    fi

    if [ -f "$PLIST_PATH" ]; then
        rm "$PLIST_PATH"
        success "Removed $PLIST_PATH"
    else
        info "Plist not found, nothing to remove"
    fi

    printf "\n${GREEN}${BOLD}TeleCode service uninstalled.${NC}\n"
    if $REMOTE_INSTALL; then
        printf "Project files in ${INSTALL_DIR} are untouched.\n"
        printf "To fully remove: rm -rf \"${INSTALL_DIR}\"\n"
    else
        printf "Project files in ${PROJECT_DIR} are untouched.\n"
    fi
    printf "To also remove app data: rm -rf \"${APP_DATA_DIR}\"\n"
    exit 0
fi

# ── Pre-flight checks ───────────────────────────────────────────────────────
step "Checking system requirements"

# macOS check
if [[ "$(uname -s)" != "Darwin" ]]; then
    error "This script is for macOS only."
    exit 1
fi
success "macOS detected ($(sw_vers -productVersion), $(uname -m))"

# Homebrew
if ! command -v brew &>/dev/null; then
    warn "Homebrew not found. Installing..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

    # Add brew to PATH for Apple Silicon
    if [[ "$(uname -m)" == "arm64" ]]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
    fi
    success "Homebrew installed"
else
    success "Homebrew found ($(brew --version | head -1))"
fi

# Node.js
if ! command -v node &>/dev/null; then
    warn "Node.js not found. Installing via Homebrew..."
    brew install node
    success "Node.js installed ($(node -v))"
else
    NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
    if (( NODE_VERSION < MIN_NODE_VERSION )); then
        error "Node.js v${MIN_NODE_VERSION}+ required, found $(node -v)"
        info "Run: brew upgrade node"
        exit 1
    fi
    success "Node.js $(node -v) found"
fi

# npm
if ! command -v npm &>/dev/null; then
    error "npm not found (should come with Node.js)"
    exit 1
fi
success "npm $(npm -v) found"

# Git (required for remote install)
if ! command -v git &>/dev/null; then
    if $REMOTE_INSTALL; then
        error "git is required for remote installation but was not found."
        info "Install with: brew install git"
        exit 1
    else
        warn "git not found (not required for local install)"
    fi
else
    success "git $(git --version | awk '{print $3}') found"
fi

# Claude Code
if ! command -v claude &>/dev/null; then
    warn "Claude Code CLI not found in PATH."
    warn "TeleCode requires Claude Code to be installed and authenticated."
    warn "Install it from: https://docs.anthropic.com/en/docs/claude-code"
    warn "Continuing installation, but the bot will not work without Claude Code."
else
    success "Claude Code CLI found"
fi

# ── Download (remote install only) ─────────────────────────────────────────
if $REMOTE_INSTALL; then
    step "Downloading Telecode"
    if [ -d "$INSTALL_DIR/.git" ]; then
        info "Updating existing installation..."
        git -C "$INSTALL_DIR" pull --ff-only
    else
        git clone "$REPO_URL" "$INSTALL_DIR"
    fi
    PROJECT_DIR="$INSTALL_DIR"
    success "Source ready at $PROJECT_DIR"
fi

# ── Install dependencies ────────────────────────────────────────────────────
step "Installing Node.js dependencies"

cd "$PROJECT_DIR"

if [ -d "node_modules" ]; then
    info "node_modules exists, running npm install to sync..."
else
    info "Installing packages..."
fi

npm install --loglevel=warn
success "Dependencies installed"

# ── Build ────────────────────────────────────────────────────────────────────
step "Building TypeScript project"

npm run build
success "Build complete (dist/index.js)"

# ── Environment configuration ────────────────────────────────────────────────
step "Checking configuration"

if [ ! -f "$PROJECT_DIR/.env" ]; then
    warn ".env file not found. Creating from template..."
    cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
    warn "You MUST edit .env before running TeleCode:"
    warn "  ${PROJECT_DIR}/.env"
    warn ""
    warn "  Required:"
    warn "    TELEGRAM_BOT_TOKEN  — Get from @BotFather on Telegram"
    warn "    ALLOWED_USER_IDS    — Your Telegram user ID(s)"
    ENV_NEEDS_EDIT=true
else
    success ".env file found"
    ENV_NEEDS_EDIT=false
fi

# ── Create data directories ─────────────────────────────────────────────────
step "Setting up data directories"

mkdir -p "$APP_DATA_DIR/logs"
success "App data: $APP_DATA_DIR"

mkdir -p "$LOG_DIR"
success "Service logs: $LOG_DIR"

# ── Verify build ─────────────────────────────────────────────────────────────
step "Verifying installation"

if [ ! -f "$PROJECT_DIR/dist/index.js" ]; then
    error "Build artifact dist/index.js not found!"
    exit 1
fi
success "dist/index.js exists"

# Quick syntax check
node --check "$PROJECT_DIR/dist/index.js" 2>/dev/null && \
    success "dist/index.js passes syntax check" || \
    warn "dist/index.js syntax check had warnings"

# ── Service installation ─────────────────────────────────────────────────────
if $INSTALL_SERVICE; then
    step "Installing LaunchAgent service"

    # Resolve full node path
    NODE_BIN=$(which node)
    info "Using Node.js: $NODE_BIN"

    # Collect PATH (ensure brew + claude are reachable)
    SERVICE_PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    if [[ "$(uname -m)" == "arm64" ]]; then
        SERVICE_PATH="/opt/homebrew/bin:$SERVICE_PATH"
    fi
    # Include user's local bin for claude
    SERVICE_PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$SERVICE_PATH"

    # Stop existing service if running
    if launchctl list 2>/dev/null | grep -q "$PLIST_LABEL"; then
        info "Stopping existing service..."
        launchctl bootout "gui/$(id -u)/$PLIST_LABEL" 2>/dev/null || true
        sleep 1
    fi

    # Write plist
    cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_LABEL}</string>

    <key>ProgramArguments</key>
    <array>
        <string>${NODE_BIN}</string>
        <string>${PROJECT_DIR}/dist/index.js</string>
    </array>

    <key>WorkingDirectory</key>
    <string>${PROJECT_DIR}</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${SERVICE_PATH}</string>
        <key>HOME</key>
        <string>${HOME}</string>
        <key>NODE_ENV</key>
        <string>production</string>
    </dict>

    <!-- Start on login -->
    <key>RunAtLoad</key>
    <true/>

    <!-- Restart if it crashes -->
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>

    <!-- Wait 10s before restarting after crash -->
    <key>ThrottleInterval</key>
    <integer>10</integer>

    <!-- Log stdout/stderr -->
    <key>StandardOutPath</key>
    <string>${LOG_DIR}/stdout.log</string>
    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/stderr.log</string>

    <!-- Soft kill timeout before SIGKILL -->
    <key>ExitTimeOut</key>
    <integer>15</integer>

    <key>ProcessType</key>
    <string>Interactive</string>
</dict>
</plist>
PLIST

    success "Created $PLIST_PATH"

    if $ENV_NEEDS_EDIT; then
        warn "Service NOT started — .env needs configuration first."
        warn "After editing .env, start with:"
        warn "  launchctl bootstrap gui/$(id -u) $PLIST_PATH"
    else
        info "Starting service..."
        launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
        sleep 2

        # Check if running
        if launchctl print "gui/$(id -u)/$PLIST_LABEL" &>/dev/null; then
            success "Service is running"
        else
            warn "Service may have failed to start. Check logs:"
            warn "  tail -f $LOG_DIR/stderr.log"
        fi
    fi
fi

# ── Summary ──────────────────────────────────────────────────────────────────
# Read version from package.json
APP_VERSION=$(node -e "console.log(require('$PROJECT_DIR/package.json').version)" 2>/dev/null || echo "unknown")
GIT_HASH=$(git -C "$PROJECT_DIR" rev-parse --short HEAD 2>/dev/null || echo "unknown")

step "Installation complete — v${APP_VERSION} (${GIT_HASH})"

printf "\n"
printf "  ${BOLD}Version:${NC}     v%s (%s)\n" "$APP_VERSION" "$GIT_HASH"
printf "  ${BOLD}Project:${NC}     %s\n" "$PROJECT_DIR"
printf "  ${BOLD}App data:${NC}    %s\n" "$APP_DATA_DIR"
printf "  ${BOLD}Config:${NC}      %s/.env\n" "$PROJECT_DIR"

if $INSTALL_SERVICE; then
    printf "  ${BOLD}Service:${NC}     %s\n" "$PLIST_LABEL"
    printf "  ${BOLD}Plist:${NC}       %s\n" "$PLIST_PATH"
    printf "  ${BOLD}Logs:${NC}        %s/\n" "$LOG_DIR"
fi

printf "\n${BOLD}Quick reference:${NC}\n"
printf "  %-42s %s\n" "Run manually:" "cd $PROJECT_DIR && npm run dev"
printf "  %-42s %s\n" "Run production:" "cd $PROJECT_DIR && node dist/index.js"

if $INSTALL_SERVICE; then
    printf "\n${BOLD}Service commands:${NC}\n"
    printf "  %-42s %s\n" "Start service:" "launchctl bootstrap gui/\$(id -u) $PLIST_PATH"
    printf "  %-42s %s\n" "Stop service:" "launchctl bootout gui/\$(id -u)/$PLIST_LABEL"
    printf "  %-42s %s\n" "Check status:" "launchctl print gui/\$(id -u)/$PLIST_LABEL"
    printf "  %-42s %s\n" "View stdout:" "tail -f $LOG_DIR/stdout.log"
    printf "  %-42s %s\n" "View stderr:" "tail -f $LOG_DIR/stderr.log"
    printf "  %-42s %s\n" "Uninstall service:" "$PROJECT_DIR/install.sh --uninstall"
fi

if $REMOTE_INSTALL; then
    printf "\n${BOLD}Update:${NC}\n"
    printf "  %-42s %s\n" "Update Telecode:" "cd $PROJECT_DIR && git pull && npm install && npm run build"
    printf "\n${BOLD}Uninstall:${NC}\n"
    printf "  %-42s %s\n" "Remove everything:" "rm -rf \"$PROJECT_DIR\" \"$APP_DATA_DIR\" \"$LOG_DIR\""
fi

if $ENV_NEEDS_EDIT; then
    printf "\n${YELLOW}${BOLD}ACTION REQUIRED:${NC} Edit your .env file before running:\n"
    printf "  ${BOLD}nano %s/.env${NC}\n" "$PROJECT_DIR"
fi

printf "\n"
