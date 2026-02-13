import { describe, it, expect, vi } from 'vitest';
import { userInfo } from 'node:os';
import {
  SanitizationPipeline,
  createDefaultPipeline,
  type CategoryHandler,
  type SanitizeCategory,
} from '../../src/sanitize/pipeline.js';
import { TelecodeError } from '../../src/types/errors.js';

// ---------------------------------------------------------------------------
// Helper: create a minimal handler for testing
// ---------------------------------------------------------------------------
function stubHandler(
  category: SanitizeCategory,
  pattern: RegExp,
): CategoryHandler {
  return {
    category,
    detect(text: string) {
      return [...text.matchAll(pattern)];
    },
    mask(text: string) {
      return text.replace(pattern, `[REDACTED:${category}]`);
    },
  };
}

// ---------------------------------------------------------------------------
// SanitizationPipeline core behavior
// ---------------------------------------------------------------------------
describe('SanitizationPipeline', () => {
  it('returns text unchanged when no handlers match', () => {
    const pipeline = new SanitizationPipeline([]);
    const result = pipeline.sanitize('hello world');

    expect(result.text).toBe('hello world');
    expect(result.redactionCount).toBe(0);
    expect(result.categories).toEqual([]);
  });

  it('handles empty string input', () => {
    const pipeline = createDefaultPipeline();
    const result = pipeline.sanitize('');

    expect(result.text).toBe('');
    expect(result.redactionCount).toBe(0);
    expect(result.categories).toEqual([]);
  });

  it('tracks redaction count across multiple handlers', () => {
    const pipeline = new SanitizationPipeline([
      stubHandler('api_key', /SECRET_A/g),
      stubHandler('password', /SECRET_B/g),
    ]);

    const result = pipeline.sanitize('SECRET_A and SECRET_B and SECRET_A');

    expect(result.redactionCount).toBe(3);
    expect(result.categories).toContain('api_key');
    expect(result.categories).toContain('password');
  });

  it('does not duplicate categories', () => {
    const handler = stubHandler('api_key', /KEY/g);
    const pipeline = new SanitizationPipeline([handler]);
    const result = pipeline.sanitize('KEY KEY KEY');

    expect(result.categories).toEqual(['api_key']);
    expect(result.redactionCount).toBe(3);
  });

  it('wraps handler errors in TelecodeError with INTERNAL_ERROR', () => {
    const brokenHandler: CategoryHandler = {
      category: 'secret',
      detect() {
        throw new Error('boom');
      },
      mask(text) {
        return text;
      },
    };

    const pipeline = new SanitizationPipeline([brokenHandler]);

    expect(() => pipeline.sanitize('anything')).toThrow(TelecodeError);

    try {
      pipeline.sanitize('anything');
    } catch (err) {
      expect(err).toBeInstanceOf(TelecodeError);
      const telecodeErr = err as TelecodeError;
      expect(telecodeErr.code).toBe('INTERNAL_ERROR');
      expect(telecodeErr.message).toContain('secret');
      expect(telecodeErr.message).toContain('boom');
      expect(telecodeErr.cause).toBeInstanceOf(Error);
    }
  });

  it('wraps non-Error throws in TelecodeError', () => {
    const brokenHandler: CategoryHandler = {
      category: 'api_key',
      detect() {
        throw 'string error'; // eslint-disable-line no-throw-literal
      },
      mask(text) {
        return text;
      },
    };

    const pipeline = new SanitizationPipeline([brokenHandler]);

    expect(() => pipeline.sanitize('anything')).toThrow(TelecodeError);

    try {
      pipeline.sanitize('anything');
    } catch (err) {
      const telecodeErr = err as TelecodeError;
      expect(telecodeErr.code).toBe('INTERNAL_ERROR');
      expect(telecodeErr.cause).toBeUndefined();
    }
  });

  it('runs handlers in order', () => {
    // First handler replaces "AAA" with a placeholder, second handler should
    // NOT see "AAA" any more.
    const h1 = stubHandler('api_key', /AAA/g);
    const h2: CategoryHandler = {
      category: 'password',
      detect(text) {
        return [...text.matchAll(/AAA/g)];
      },
      mask(text) {
        return text.replace(/AAA/g, '[REDACTED:password]');
      },
    };

    const pipeline = new SanitizationPipeline([h1, h2]);
    const result = pipeline.sanitize('AAA');

    // Only h1 should have matched — AAA was already replaced before h2 ran.
    expect(result.text).toBe('[REDACTED:api_key]');
    expect(result.categories).toEqual(['api_key']);
    expect(result.redactionCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// API Key handler
// ---------------------------------------------------------------------------
describe('API Key handler', () => {
  const pipeline = createDefaultPipeline();

  it('redacts OpenAI-style sk- keys', () => {
    const key = 'sk-abc123def456ghi789jkl012mno';
    const result = pipeline.sanitize(`My key is ${key} ok?`);

    expect(result.text).toBe('My key is [REDACTED:api_key] ok?');
    expect(result.redactionCount).toBeGreaterThanOrEqual(1);
    expect(result.categories).toContain('api_key');
  });

  it('redacts OpenAI project keys (sk-proj-)', () => {
    const key = 'sk-proj-abcdefghij1234567890';
    const result = pipeline.sanitize(key);

    expect(result.text).toBe('[REDACTED:api_key]');
  });

  it('redacts key- prefixed keys', () => {
    const key = 'key-abcdefghij1234567890klmn';
    const result = pipeline.sanitize(`token: ${key}`);

    // Both bearer_token and api_key might match here; just ensure api_key is redacted
    expect(result.text).not.toContain(key);
    expect(result.categories).toContain('api_key');
  });

  it('redacts AWS access key IDs (AKIA...)', () => {
    const key = 'AKIAIOSFODNN7EXAMPLE';
    const result = pipeline.sanitize(`aws_key=${key}`);

    expect(result.text).not.toContain(key);
    expect(result.categories).toContain('api_key');
  });

  it('does not redact short strings that look similar', () => {
    const result = pipeline.sanitize('sk-short');

    // "sk-short" is only 8 chars, below the 20-char minimum after prefix
    expect(result.text).toBe('sk-short');
  });

  it('redacts multiple keys in the same text', () => {
    const k1 = 'sk-aaaabbbbccccddddeeeefffff';
    const k2 = 'AKIAIOSFODNN7EXAMPLE';
    const result = pipeline.sanitize(`first: ${k1}, second: ${k2}`);

    expect(result.text).toBe(
      'first: [REDACTED:api_key], second: [REDACTED:api_key]',
    );
    expect(result.redactionCount).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Bearer Token handler
// ---------------------------------------------------------------------------
describe('Bearer Token handler', () => {
  const pipeline = createDefaultPipeline();

  it('redacts Bearer tokens', () => {
    const result = pipeline.sanitize(
      'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig',
    );

    expect(result.text).toBe('Authorization: [REDACTED:bearer_token]');
    expect(result.categories).toContain('bearer_token');
  });

  it('redacts token= format', () => {
    const result = pipeline.sanitize('token=abcdef1234567890');

    expect(result.text).toBe('[REDACTED:bearer_token]');
    expect(result.categories).toContain('bearer_token');
  });

  it('redacts token: format', () => {
    const result = pipeline.sanitize('token: abcdef1234567890');

    expect(result.text).toBe('[REDACTED:bearer_token]');
    expect(result.categories).toContain('bearer_token');
  });

  it('does not redact short token values', () => {
    const result = pipeline.sanitize('token=abc');

    // "abc" is only 3 chars — below 8-char minimum
    expect(result.text).toBe('token=abc');
  });
});

// ---------------------------------------------------------------------------
// Password handler
// ---------------------------------------------------------------------------
describe('Password handler', () => {
  const pipeline = createDefaultPipeline();

  it('redacts password= patterns', () => {
    const result = pipeline.sanitize('password=hunter2');

    expect(result.text).toBe('password=[REDACTED:password]');
    expect(result.categories).toContain('password');
  });

  it('redacts passwd: patterns', () => {
    const result = pipeline.sanitize('passwd: mySecret!');

    // "mySecret!" is the value (stops at whitespace for "mySecret!")
    // The handler grabs non-whitespace, so it matches "mySecret!"
    expect(result.text).toBe('passwd:[REDACTED:password]');
    expect(result.categories).toContain('password');
  });

  it('redacts secret_key= patterns', () => {
    const result = pipeline.sanitize('secret_key=s3cr3tV4lue');

    expect(result.text).toBe('secret_key=[REDACTED:password]');
    expect(result.categories).toContain('password');
  });

  it('is case-insensitive', () => {
    const result = pipeline.sanitize('PASSWORD=verysecure');

    expect(result.text).toBe('PASSWORD=[REDACTED:password]');
  });

  it('handles multiple password fields', () => {
    const result = pipeline.sanitize(
      'password=abc123 passwd:xyz789 secret_key=hello',
    );

    expect(result.text).toBe(
      'password=[REDACTED:password] passwd:[REDACTED:password] secret_key=[REDACTED:password]',
    );
    expect(result.redactionCount).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// Path handler
// ---------------------------------------------------------------------------
describe('Path handler', () => {
  const pipeline = createDefaultPipeline();
  const username = userInfo().username;

  it('redacts /Users/<username>/... paths', () => {
    const result = pipeline.sanitize(
      `Reading file /Users/${username}/Documents/secrets.txt`,
    );

    expect(result.text).toBe('Reading file [REDACTED:path]');
    expect(result.categories).toContain('path');
  });

  it('redacts ~/... paths', () => {
    const result = pipeline.sanitize('Config at ~/.ssh/id_rsa');

    expect(result.text).toBe('Config at [REDACTED:path]');
    expect(result.categories).toContain('path');
  });

  it('redacts multiple paths', () => {
    const result = pipeline.sanitize(
      `Copied /Users/${username}/a to ~/b`,
    );

    expect(result.text).toBe('Copied [REDACTED:path] to [REDACTED:path]');
    expect(result.redactionCount).toBeGreaterThanOrEqual(2);
  });

  it('does not redact other users paths', () => {
    const result = pipeline.sanitize('/Users/someoneelse/file.txt');

    // Should be left intact unless someoneelse happens to be the current user
    if (username !== 'someoneelse') {
      expect(result.text).toBe('/Users/someoneelse/file.txt');
    }
  });

  it('does not redact bare ~ without path', () => {
    const result = pipeline.sanitize('The tilde char is ~');

    expect(result.text).toBe('The tilde char is ~');
  });
});

// ---------------------------------------------------------------------------
// Default pipeline integration
// ---------------------------------------------------------------------------
describe('createDefaultPipeline integration', () => {
  const pipeline = createDefaultPipeline();

  it('handles text with multiple categories of secrets', () => {
    const username = userInfo().username;
    const text = [
      `key: sk-aaaa1111bbbb2222cccc3333dddd`,
      `auth: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig`,
      `password=supersecret`,
      `path: /Users/${username}/Desktop/app`,
    ].join('\n');

    const result = pipeline.sanitize(text);

    expect(result.text).not.toContain('sk-');
    expect(result.text).not.toContain('Bearer');
    expect(result.text).not.toContain('supersecret');
    expect(result.text).not.toContain(username);

    expect(result.categories).toContain('api_key');
    expect(result.categories).toContain('bearer_token');
    expect(result.categories).toContain('password');
    expect(result.categories).toContain('path');

    expect(result.redactionCount).toBeGreaterThanOrEqual(4);
  });

  it('passes clean text through unchanged', () => {
    const clean = 'Hello! This is a perfectly normal message with no secrets.';
    const result = pipeline.sanitize(clean);

    expect(result.text).toBe(clean);
    expect(result.redactionCount).toBe(0);
    expect(result.categories).toEqual([]);
  });

  it('handles text that contains redaction markers already', () => {
    const text = 'Previously: [REDACTED:api_key] is fine';
    const result = pipeline.sanitize(text);

    expect(result.text).toBe(text);
    expect(result.redactionCount).toBe(0);
  });
});
