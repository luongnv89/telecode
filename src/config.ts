import { z } from 'zod';
import { config as loadDotenv } from 'dotenv';
import { homedir } from 'node:os';
import { join } from 'node:path';

loadDotenv();

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
    .default('1800000')
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
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(): AppConfig {
  const result = configSchema.safeParse({
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    allowedUserIds: process.env.ALLOWED_USER_IDS,
    logPath: process.env.LOG_PATH || undefined,
    claudeModel: process.env.CLAUDE_MODEL || undefined,
    sessionTimeoutMs: process.env.SESSION_TIMEOUT_MS || undefined,
    maxSessions: process.env.MAX_SESSIONS || undefined,
    sessionsFilePath: process.env.SESSIONS_FILE_PATH || undefined,
    bookmarksFilePath: process.env.BOOKMARKS_FILE_PATH || undefined,
  });

  if (!result.success) {
    const errors = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${errors}`);
  }

  return result.data;
}
