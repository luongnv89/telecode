import { z } from 'zod';
import { config as loadDotenv } from 'dotenv';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface ConfigOverrides {
  envFilePath?: string;
  telegramBotToken?: string;
  allowedUserIds?: string;
  defaultBackend?: string;
  workspace?: string;
}

const DEFAULT_LOG_PATH = join(
  homedir(),
  'Library',
  'Application Support',
  'telecode',
  'logs'
);

const DEFAULT_SESSIONS_FILE = join(
  homedir(),
  'Library',
  'Application Support',
  'telecode',
  'sessions.json'
);

const DEFAULT_BOOKMARKS_FILE = join(
  homedir(),
  'Library',
  'Application Support',
  'telecode',
  'bookmarks.json'
);

const configSchema = z.object({
  telegramBotToken: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  allowedUserIds: z
    .string()
    .min(1, 'ALLOWED_USER_IDS is required')
    .transform((s) => s.split(',').map((id) => parseInt(id.trim(), 10)))
    .pipe(z.array(z.number().int().positive())),
  logPath: z
    .string()
    .optional()
    .default(DEFAULT_LOG_PATH),
  claudeModel: z
    .string()
    .optional(),
  sessionTimeoutMs: z
    .string()
    .optional()
    .default('86400000')
    .transform((s) => parseInt(s, 10))
    .pipe(z.number().int().positive()),
  maxSessions: z
    .string()
    .optional()
    .default('5')
    .transform((s) => parseInt(s, 10))
    .pipe(z.number().int().positive().max(10)),
  sessionsFilePath: z
    .string()
    .optional()
    .default(DEFAULT_SESSIONS_FILE),
  bookmarksFilePath: z
    .string()
    .optional()
    .default(DEFAULT_BOOKMARKS_FILE),
  defaultDisplayMode: z
    .enum(['concise', 'verbose'])
    .optional()
    .default('concise'),
  permissionTimeoutMs: z
    .string()
    .optional()
    .default('60000')
    .transform((s) => parseInt(s, 10))
    .pipe(z.number().int().positive()),
  defaultBackend: z
    .enum(['claude', 'opencode', 'codex'])
    .optional()
    .default('claude'),
  opencodeBaseUrl: z
    .string()
    .optional(),
  opencodeModel: z
    .string()
    .optional(),
  workspace: z
    .string()
    .optional()
    .default(homedir()),
  allowedTools: z
    .string()
    .optional()
    .default('claude')
    .transform((s) => s.split(',').map((t) => t.trim()).filter(Boolean))
    .pipe(z.array(z.enum(['claude', 'opencode', 'codex']))),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(overrides?: ConfigOverrides): AppConfig {
  loadDotenv({ path: overrides?.envFilePath });

  const result = configSchema.safeParse({
    telegramBotToken: overrides?.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN,
    allowedUserIds: overrides?.allowedUserIds || process.env.ALLOWED_USER_IDS,
    logPath: process.env.LOG_PATH || undefined,
    claudeModel: process.env.CLAUDE_MODEL || undefined,
    sessionTimeoutMs: process.env.SESSION_TIMEOUT_MS || undefined,
    maxSessions: process.env.MAX_SESSIONS || undefined,
    sessionsFilePath: process.env.SESSIONS_FILE_PATH || undefined,
    bookmarksFilePath: process.env.BOOKMARKS_FILE_PATH || undefined,
    defaultDisplayMode: process.env.DEFAULT_DISPLAY_MODE || undefined,
    permissionTimeoutMs: process.env.PERMISSION_TIMEOUT_MS || undefined,
    defaultBackend: overrides?.defaultBackend || process.env.DEFAULT_BACKEND || undefined,
    opencodeBaseUrl: process.env.OPENCODE_BASE_URL || undefined,
    opencodeModel: process.env.OPENCODE_MODEL || undefined,
    workspace: overrides?.workspace || process.env.WORKSPACE || undefined,
    allowedTools: process.env.ALLOWED_TOOLS || undefined,
  });

  if (!result.success) {
    const errors = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${errors}`);
  }

  return result.data;
}
