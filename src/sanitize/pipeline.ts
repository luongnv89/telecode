import { userInfo } from 'node:os';
import { TelecodeError } from '../types/errors.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SanitizeCategory =
  | 'api_key'
  | 'bearer_token'
  | 'password'
  | 'secret'
  | 'path';

export interface SanitizeResult {
  text: string;
  redactionCount: number;
  categories: SanitizeCategory[];
}

export interface CategoryHandler {
  category: SanitizeCategory;
  detect(text: string): RegExpMatchArray[];
  mask(text: string): string;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export class SanitizationPipeline {
  private readonly handlers: CategoryHandler[];

  constructor(handlers: CategoryHandler[]) {
    this.handlers = handlers;
  }

  sanitize(text: string): SanitizeResult {
    let result = text;
    let redactionCount = 0;
    const categories: SanitizeCategory[] = [];

    for (const handler of this.handlers) {
      try {
        const matches = handler.detect(result);
        if (matches.length > 0) {
          result = handler.mask(result);
          redactionCount += matches.length;
          if (!categories.includes(handler.category)) {
            categories.push(handler.category);
          }
        }
      } catch (err) {
        throw new TelecodeError(
          `Sanitization handler "${handler.category}" failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
          'INTERNAL_ERROR',
          { cause: err instanceof Error ? err : undefined },
        );
      }
    }

    return { text: result, redactionCount, categories };
  }
}

// ---------------------------------------------------------------------------
// Built-in category handlers
// ---------------------------------------------------------------------------

function createApiKeyHandler(): CategoryHandler {
  // Matches common API key patterns:
  //   sk-<base64/hex chars 20+>    (OpenAI-style)
  //   sk-proj-<chars>              (OpenAI project keys)
  //   key-<base64/hex chars 20+>
  //   AKIA[A-Z0-9]{16}            (AWS access key IDs)
  const pattern =
    /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{20,}|key-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b/g;

  return {
    category: 'api_key',
    detect(text: string): RegExpMatchArray[] {
      return [...text.matchAll(pattern)];
    },
    mask(text: string): string {
      return text.replace(pattern, '[REDACTED:api_key]');
    },
  };
}

function createBearerTokenHandler(): CategoryHandler {
  // Matches:
  //   Bearer <token>
  //   token: <token>   /  token=<token>
  const pattern =
    /\b(?:Bearer\s+[A-Za-z0-9_.\-/+=]{8,}|[Tt]oken[=:]\s*[A-Za-z0-9_.\-/+=]{8,})/g;

  return {
    category: 'bearer_token',
    detect(text: string): RegExpMatchArray[] {
      return [...text.matchAll(pattern)];
    },
    mask(text: string): string {
      return text.replace(pattern, '[REDACTED:bearer_token]');
    },
  };
}

function createPasswordHandler(): CategoryHandler {
  // Matches:
  //   password=<value>  password:<value>  passwd=<value>  passwd:<value>
  //   secret_key=<value>  secret_key:<value>
  // Value continues until whitespace, quote, or end of string.
  const pattern =
    /\b(?:password|passwd|secret_key)[=:]\s*\S+/gi;

  return {
    category: 'password',
    detect(text: string): RegExpMatchArray[] {
      return [...text.matchAll(pattern)];
    },
    mask(text: string): string {
      return text.replace(pattern, (match) => {
        const sep = match.match(/[=:]/);
        const key = match.slice(0, match.indexOf(sep![0]));
        return `${key}${sep![0]}[REDACTED:password]`;
      });
    },
  };
}

function createPathHandler(): CategoryHandler {
  // Detect the current macOS username so we can redact personal home paths.
  let username: string;
  try {
    username = userInfo().username;
  } catch {
    username = '';
  }

  // Build patterns dynamically.
  // 1. /Users/<username>/...  (macOS home directories)
  // 2. ~/...                  (home shorthand)
  const patterns: RegExp[] = [];
  if (username) {
    // Escaped username for regex safety (in case of special chars)
    const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    patterns.push(new RegExp(`/Users/${escaped}(/[^\\s"'\`]*)`, 'g'));
  }
  patterns.push(/~(\/[^\s"'`]*)/g);

  return {
    category: 'path',
    detect(text: string): RegExpMatchArray[] {
      const allMatches: RegExpMatchArray[] = [];
      for (const p of patterns) {
        allMatches.push(...text.matchAll(p));
      }
      return allMatches;
    },
    mask(text: string): string {
      let result = text;
      for (const p of patterns) {
        result = result.replace(p, '[REDACTED:path]');
      }
      return result;
    },
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createDefaultPipeline(): SanitizationPipeline {
  return new SanitizationPipeline([
    createApiKeyHandler(),
    createBearerTokenHandler(),
    createPasswordHandler(),
    createPathHandler(),
  ]);
}
