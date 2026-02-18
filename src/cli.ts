#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, openSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { spawn, execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DATA_DIR = join(homedir(), 'Library', 'Application Support', 'telecode');
const PID_FILE = join(DATA_DIR, 'telecode.pid');
const LOG_DIR = join(homedir(), 'Library', 'Logs', 'telecode');

function loadPackageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function printUsage(): void {
  const version = loadPackageVersion();
  console.log(`
telecode v${version} — Telegram bot for Claude Code

Usage: telecode <command> [options]

Commands:
  start             Start the bot (foreground by default)
  stop              Stop a running daemon
  status            Show daemon status
  config            Display resolved configuration (secrets masked)
  version           Print version
  help              Show this help message

Options (for 'start'):
  -t, --token       Override TELEGRAM_BOT_TOKEN
  -u, --users       Override ALLOWED_USER_IDS
  -b, --backend     Override DEFAULT_BACKEND
  -w, --workspace   Override WORKSPACE
      --env-file    Path to a custom .env file
      --daemon      Run as a background daemon

Examples:
  telecode start
  telecode start --daemon
  telecode start -b opencode --env-file /path/to/.env
  telecode stop
  telecode status
`);
}

function readPidFile(): number | null {
  try {
    const content = readFileSync(PID_FILE, 'utf-8').trim();
    const pid = parseInt(content, 10);
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getProcessUptime(pid: number): string {
  try {
    const etime = execSync(`ps -o etime= -p ${pid}`, { encoding: 'utf-8' }).trim();
    return etime;
  } catch {
    return 'unknown';
  }
}

function writePidFile(pid: number): void {
  mkdirSync(dirname(PID_FILE), { recursive: true });
  writeFileSync(PID_FILE, String(pid), 'utf-8');
}

function removePidFile(): void {
  try {
    unlinkSync(PID_FILE);
  } catch {
    // ignore if already gone
  }
}

async function cmdStart(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      token:      { type: 'string', short: 't' },
      users:      { type: 'string', short: 'u' },
      backend:    { type: 'string', short: 'b' },
      workspace:  { type: 'string', short: 'w' },
      'env-file': { type: 'string' },
      daemon:     { type: 'boolean', default: false },
    },
    strict: true,
  });

  const overrides = {
    telegramBotToken: values.token,
    allowedUserIds:   values.users,
    defaultBackend:   values.backend,
    workspace:        values.workspace,
    envFilePath:      values['env-file'],
  };

  if (values.daemon) {
    // Check if already running
    const existingPid = readPidFile();
    if (existingPid && isProcessRunning(existingPid)) {
      console.error(`telecode is already running (PID ${existingPid}). Use 'telecode stop' first.`);
      process.exit(1);
    }

    // Ensure log directory exists
    mkdirSync(LOG_DIR, { recursive: true });

    const stdoutLog = join(LOG_DIR, 'stdout.log');
    const stderrLog = join(LOG_DIR, 'stderr.log');

    const out = openSync(stdoutLog, 'a');
    const err = openSync(stderrLog, 'a');

    // Build child args: re-invoke cli.ts start with same flags but without --daemon
    const childArgs = [fileURLToPath(import.meta.url), 'start'];
    if (values.token)      childArgs.push('--token', values.token);
    if (values.users)      childArgs.push('--users', values.users);
    if (values.backend)    childArgs.push('--backend', values.backend);
    if (values.workspace)  childArgs.push('--workspace', values.workspace);
    if (values['env-file']) childArgs.push('--env-file', values['env-file']);

    const child = spawn(process.execPath, childArgs, {
      detached: true,
      stdio: ['ignore', out, err],
    });

    child.unref();

    if (child.pid) {
      writePidFile(child.pid);
      console.log(`telecode started as daemon (PID ${child.pid})`);
      console.log(`  stdout: ${stdoutLog}`);
      console.log(`  stderr: ${stderrLog}`);
    } else {
      console.error('Failed to start daemon.');
      process.exit(1);
    }
    return;
  }

  // Foreground mode — dynamically import to avoid loading heavy deps for other commands
  const { main } = await import('./index.js');
  await main(overrides);
}

function cmdStop(): void {
  const pid = readPidFile();
  if (!pid) {
    console.log('telecode is not running (no PID file found).');
    return;
  }

  if (!isProcessRunning(pid)) {
    console.log(`telecode is not running (stale PID file, PID ${pid}).`);
    removePidFile();
    return;
  }

  console.log(`Stopping telecode (PID ${pid})...`);
  try {
    process.kill(pid, 'SIGTERM');
  } catch (e) {
    console.error(`Failed to send SIGTERM to PID ${pid}:`, e);
    process.exit(1);
  }

  // Wait up to 10 seconds for the process to exit
  const deadline = Date.now() + 10_000;
  const poll = (): void => {
    if (!isProcessRunning(pid)) {
      removePidFile();
      console.log('telecode stopped.');
      return;
    }
    if (Date.now() > deadline) {
      console.warn(`Process ${pid} did not exit in 10s. Sending SIGKILL...`);
      try { process.kill(pid, 'SIGKILL'); } catch { /* ignore */ }
      removePidFile();
      console.log('telecode killed.');
      return;
    }
    setTimeout(poll, 200);
  };
  poll();
}

function cmdStatus(): void {
  const pid = readPidFile();
  if (!pid) {
    console.log('telecode is not running (no PID file).');
    return;
  }

  if (!isProcessRunning(pid)) {
    console.log(`telecode is not running (stale PID file, PID ${pid}).`);
    removePidFile();
    return;
  }

  const uptime = getProcessUptime(pid);
  console.log(`telecode is running`);
  console.log(`  PID:    ${pid}`);
  console.log(`  Uptime: ${uptime}`);
  console.log(`  PID file: ${PID_FILE}`);
}

async function cmdConfig(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      'env-file': { type: 'string' },
    },
    strict: true,
  });

  // Load dotenv to populate process.env
  const dotenv = await import('dotenv');
  dotenv.config({ path: values['env-file'] });

  const mask = (val: string | undefined): string => {
    if (!val) return '(not set)';
    if (val.length <= 8) return '****';
    return val.slice(0, 4) + '****' + val.slice(-4);
  };

  console.log('Resolved configuration:\n');
  console.log(`  TELEGRAM_BOT_TOKEN:   ${mask(process.env.TELEGRAM_BOT_TOKEN)}`);
  console.log(`  ALLOWED_USER_IDS:     ${process.env.ALLOWED_USER_IDS || '(not set)'}`);
  console.log(`  DEFAULT_BACKEND:      ${process.env.DEFAULT_BACKEND || 'claude'}`);
  console.log(`  WORKSPACE:            ${process.env.WORKSPACE || homedir()}`);
  console.log(`  LOG_PATH:             ${process.env.LOG_PATH || '(default)'}`);
  console.log(`  CLAUDE_MODEL:         ${process.env.CLAUDE_MODEL || '(default)'}`);
  console.log(`  SESSION_TIMEOUT_MS:   ${process.env.SESSION_TIMEOUT_MS || '1800000'}`);
  console.log(`  MAX_SESSIONS:         ${process.env.MAX_SESSIONS || '5'}`);
  console.log(`  DEFAULT_DISPLAY_MODE: ${process.env.DEFAULT_DISPLAY_MODE || 'concise'}`);
  console.log(`  OPENCODE_BASE_URL:    ${process.env.OPENCODE_BASE_URL || '(not set)'}`);
  console.log(`  OPENCODE_MODEL:       ${process.env.OPENCODE_MODEL || '(not set)'}`);
  console.log(`  ALLOWED_TOOLS:        ${process.env.ALLOWED_TOOLS || 'claude'}`);
  console.log(`\n  .env file: ${values['env-file'] || '.env (default)'}`);
}

async function cmdVersion(): Promise<void> {
  try {
    const { VERSION_STRING } = await import('./version.js');
    console.log(`telecode ${VERSION_STRING}`);
  } catch {
    const version = loadPackageVersion();
    console.log(`telecode v${version}`);
  }
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const subArgs = args.slice(1);

  switch (command) {
    case 'start':
      await cmdStart(subArgs);
      break;
    case 'stop':
      cmdStop();
      break;
    case 'status':
      cmdStatus();
      break;
    case 'config':
      await cmdConfig(subArgs);
      break;
    case 'version':
    case '--version':
    case '-v':
      await cmdVersion();
      break;
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      printUsage();
      break;
    default:
      console.error(`Unknown command: ${command}\n`);
      printUsage();
      process.exit(1);
  }
}

run().catch((err) => {
  console.error('[telecode] Fatal error:', err);
  process.exit(1);
});
