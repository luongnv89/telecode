import { describe, it, expect } from 'vitest';
import {
  applyMaskingRules,
  createRegexMasker,
  DEFAULT_MASKING_RULES,
  type MaskingRule,
} from '../../src/sanitize/regex-masking.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convenience: run the default masker on a string and return the result. */
function mask(text: string) {
  return applyMaskingRules(text, DEFAULT_MASKING_RULES);
}

// ---------------------------------------------------------------------------
// Core function behaviour
// ---------------------------------------------------------------------------

describe('applyMaskingRules', () => {
  it('returns the original text when no rules are provided', () => {
    const result = applyMaskingRules('hello world', []);
    expect(result.text).toBe('hello world');
    expect(result.appliedRules).toEqual([]);
    expect(result.totalReplacements).toBe(0);
  });

  it('handles empty input string', () => {
    const result = mask('');
    expect(result.text).toBe('');
    expect(result.appliedRules).toEqual([]);
    expect(result.totalReplacements).toBe(0);
  });

  it('applies rules sequentially -- order matters', () => {
    const rules: MaskingRule[] = [
      { name: 'first', pattern: /foo/g, replacement: 'bar' },
      { name: 'second', pattern: /bar/g, replacement: 'baz' },
    ];
    const result = applyMaskingRules('foo', rules);
    // "foo" -> "bar" (first) -> "baz" (second)
    expect(result.text).toBe('baz');
    expect(result.appliedRules).toEqual(['first', 'second']);
    expect(result.totalReplacements).toBe(2);
  });

  it('tracks the correct number of replacements across multiple matches', () => {
    const rules: MaskingRule[] = [
      { name: 'vowels', pattern: /[aeiou]/g, replacement: '*' },
    ];
    const result = applyMaskingRules('hello world', rules);
    expect(result.text).toBe('h*ll* w*rld');
    expect(result.totalReplacements).toBe(3);
  });

  it('does not list a rule that did not match', () => {
    const rules: MaskingRule[] = [
      { name: 'digits', pattern: /\d+/g, replacement: '#' },
    ];
    const result = applyMaskingRules('no digits here', rules);
    expect(result.appliedRules).toEqual([]);
    expect(result.totalReplacements).toBe(0);
    expect(result.text).toBe('no digits here');
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('produces identical output for identical input (multiple calls)', () => {
    const input =
      'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const a = mask(input);
    const b = mask(input);
    expect(a.text).toBe(b.text);
    expect(a.appliedRules).toEqual(b.appliedRules);
    expect(a.totalReplacements).toBe(b.totalReplacements);
  });

  it('is deterministic even after calling the function many times', () => {
    const input = 'sk-abc12345678901234567890 and key-xxxxxxxxxxxxxxxxxxxxxxxxx';
    const results = Array.from({ length: 20 }, () => mask(input));
    const first = results[0];
    for (const r of results) {
      expect(r.text).toBe(first.text);
    }
  });
});

// ---------------------------------------------------------------------------
// Rule category: API keys
// ---------------------------------------------------------------------------

describe('API key masking', () => {
  it('masks OpenAI sk- keys', () => {
    const result = mask('my key is sk-abcdefghijklmnopqrstuvwxyz');
    expect(result.text).toBe('my key is ***');
    expect(result.appliedRules).toContain('openai-api-key');
  });

  it('masks OpenAI sk-proj- keys', () => {
    const result = mask(
      'export OPENAI_KEY=sk-proj-aBcDeFgHiJkLmNoPqRsTuVwXyZ_012345',
    );
    expect(result.text).not.toContain('sk-proj-');
    expect(result.appliedRules).toContain('openai-project-key');
  });

  it('masks AWS access key IDs', () => {
    const result = mask('aws_access_key_id = AKIAIOSFODNN7EXAMPLE');
    expect(result.text).toBe('aws_access_key_id = ***');
    expect(result.appliedRules).toContain('aws-access-key');
  });

  it('masks generic key- prefixed secrets', () => {
    const result = mask('api key-abcdef0123456789abcdef');
    expect(result.text).toBe('api ***');
    expect(result.appliedRules).toContain('generic-key');
  });

  it('does not mask short key- strings (fewer than 20 chars after prefix)', () => {
    const result = mask('key-short');
    expect(result.text).toBe('key-short');
  });

  it('does not mask sk- with fewer than 20 chars', () => {
    const result = mask('the word sk-etch is fine');
    expect(result.text).toBe('the word sk-etch is fine');
  });
});

// ---------------------------------------------------------------------------
// Rule category: Bearer tokens
// ---------------------------------------------------------------------------

describe('Bearer token masking', () => {
  it('masks a JWT bearer token', () => {
    const token =
      'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const result = mask(`Authorization: ${token}`);
    expect(result.text).toBe('Authorization: ***');
    expect(result.appliedRules).toContain('bearer-token');
  });

  it('masks bearer token with base64 padding', () => {
    const result = mask('Bearer dGVzdHRva2Vu==');
    expect(result.text).toBe('***');
    expect(result.appliedRules).toContain('bearer-token');
  });
});

// ---------------------------------------------------------------------------
// Rule category: Generic tokens
// ---------------------------------------------------------------------------

describe('generic token masking', () => {
  it('masks token= assignment', () => {
    const result = mask('token=abcdefghijklmnopqrstuvwxyz');
    expect(result.text).toBe('***');
    expect(result.appliedRules).toContain('generic-token');
  });

  it('masks TOKEN: with quotes (case insensitive)', () => {
    const result = mask('TOKEN: "abcdefghijklmnopqrstuvwxyz"');
    expect(result.text).toBe('***');
    expect(result.appliedRules).toContain('generic-token');
  });

  it('masks token with single quotes', () => {
    const result = mask("token='abcdefghijklmnopqrstuvwxyz'");
    expect(result.text).toBe('***');
    expect(result.appliedRules).toContain('generic-token');
  });

  it('does not mask token references shorter than 20 chars', () => {
    const result = mask('token=abc');
    expect(result.text).toBe('token=abc');
  });
});

// ---------------------------------------------------------------------------
// Rule category: Password / passwd / secret strings
// ---------------------------------------------------------------------------

describe('password / passwd / secret masking', () => {
  it('masks password= assignment', () => {
    const result = mask('password=SuperSecret123!');
    expect(result.text).toBe('***');
    expect(result.appliedRules).toContain('password-string');
  });

  it('masks PASSWORD: with quotes (case insensitive)', () => {
    const result = mask('PASSWORD: "hunter2"');
    expect(result.text).toBe('***');
  });

  it('masks passwd= assignment', () => {
    const result = mask('passwd=s3cret');
    expect(result.text).toBe('***');
    expect(result.appliedRules).toContain('passwd-string');
  });

  it('masks secret= assignment', () => {
    const result = mask('secret=abcdefghijk');
    expect(result.text).toBe('***');
    expect(result.appliedRules).toContain('secret-string');
  });

  it('masks secret with quotes', () => {
    const result = mask("client_secret: 'my-client-secret-value'");
    // "secret: 'my-client-secret-value'" portion should be masked
    const r = mask("secret: 'my-client-secret-value'");
    expect(r.text).toBe('***');
  });

  it('does not mask password with very short value (< 4 chars)', () => {
    const result = mask('password=ab');
    expect(result.text).toBe('password=ab');
  });
});

// ---------------------------------------------------------------------------
// Rule category: Private keys
// ---------------------------------------------------------------------------

describe('private key masking', () => {
  it('masks RSA private key block', () => {
    const pem = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0Z3VS5JJcds3xfn/yGaXn0K1aK...
-----END RSA PRIVATE KEY-----`;
    const result = mask(pem);
    expect(result.text).toBe('***');
    expect(result.appliedRules).toContain('private-key');
  });

  it('masks EC private key block', () => {
    const pem = `-----BEGIN EC PRIVATE KEY-----
MHQCAQEEIBkg4LVWM9nuwNSk3yByxZpYRTBnVJk...
-----END EC PRIVATE KEY-----`;
    const result = mask(pem);
    expect(result.text).toBe('***');
    expect(result.appliedRules).toContain('private-key');
  });

  it('masks private key embedded in larger text', () => {
    const text = `Here is a key:
-----BEGIN RSA PRIVATE KEY-----
BODY
-----END RSA PRIVATE KEY-----
Done.`;
    const result = mask(text);
    expect(result.text).not.toContain('BEGIN');
    expect(result.text).toContain('Here is a key:');
    expect(result.text).toContain('Done.');
  });
});

// ---------------------------------------------------------------------------
// Rule category: Connection strings
// ---------------------------------------------------------------------------

describe('connection string masking', () => {
  it('masks postgres connection string', () => {
    const result = mask('DATABASE_URL=postgres://user:pass@host:5432/db');
    expect(result.text).toBe('DATABASE_URL=***');
    expect(result.appliedRules).toContain('connection-string');
  });

  it('masks mysql connection string', () => {
    const result = mask('mysql://root:password@localhost/mydb');
    expect(result.text).toBe('***');
  });

  it('masks mongodb connection string', () => {
    const result = mask('mongodb://admin:secret@cluster0.example.net:27017/admin');
    expect(result.text).toBe('***');
  });

  it('masks redis connection string', () => {
    const result = mask('redis://default:abc123@redis.example.com:6379');
    expect(result.text).toBe('***');
  });
});

// ---------------------------------------------------------------------------
// Rule category: Sensitive paths
// ---------------------------------------------------------------------------

describe('sensitive path masking', () => {
  it('masks .ssh paths', () => {
    const result = mask('cat /Users/john/.ssh/id_rsa');
    expect(result.text).toBe('cat ***');
    expect(result.appliedRules).toContain('sensitive-path');
  });

  it('masks .aws paths', () => {
    const result = mask('file at /Users/alice/.aws/credentials');
    expect(result.text).toBe('file at ***');
  });

  it('masks .gnupg paths', () => {
    const result = mask('/Users/bob/.gnupg/private-keys-v1.d/key.gpg');
    expect(result.text).toBe('***');
  });

  it('masks .config paths', () => {
    const result = mask('/Users/carol/.config/gcloud/credentials.json');
    expect(result.text).toBe('***');
  });

  it('masks .env paths', () => {
    const result = mask('source /Users/dev/.env.local');
    expect(result.text).toBe('source ***');
  });
});

// ---------------------------------------------------------------------------
// Rule category: Environment variable leaks
// ---------------------------------------------------------------------------

describe('environment variable leak masking', () => {
  it('masks export with key in value', () => {
    const result = mask('export AWS_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE');
    // The entire export line should be masked (env-variable-leak).
    // The AWS key itself may also be masked by the aws-access-key rule first.
    expect(result.text).toBe('***');
  });

  it('masks export with secret in variable name', () => {
    const result = mask('export DB_SECRET=some_value_with_secret');
    expect(result.text).toBe('***');
    expect(result.appliedRules).toContain('env-variable-leak');
  });

  it('masks export with token in value', () => {
    const result = mask('export GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx');
    expect(result.text).toBe('***');
  });

  it('masks export with password in value', () => {
    const result = mask('export DB_PASSWORD=hunter2');
    expect(result.text).toBe('***');
  });
});

// ---------------------------------------------------------------------------
// Multiple matches in the same text
// ---------------------------------------------------------------------------

describe('multiple matches', () => {
  it('masks several different secret types in one string', () => {
    const text = [
      'key: sk-abcdefghijklmnopqrstuvwxyz',
      'db: postgres://user:pass@host/db',
      'password=hunter22',
    ].join('\n');
    const result = mask(text);
    expect(result.text).not.toContain('sk-');
    expect(result.text).not.toContain('postgres://');
    expect(result.text).not.toContain('hunter22');
    expect(result.totalReplacements).toBeGreaterThanOrEqual(3);
  });

  it('masks two AWS keys in the same line', () => {
    const result = mask(
      'keys: AKIAIOSFODNN7EXAMPLE and AKIAI44QH8DHBEXAMPLE',
    );
    expect(result.text).toBe('keys: *** and ***');
    expect(result.totalReplacements).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// False-positive checks -- clean text must NOT be masked
// ---------------------------------------------------------------------------

describe('false-positive avoidance', () => {
  it('does not mask normal English text with the word "password"', () => {
    const text = 'Please reset your password using the link below.';
    const result = mask(text);
    // "password" alone without "= :" after it should not trigger
    expect(result.text).toBe(text);
  });

  it('does not mask the word "secret" in prose', () => {
    const text = 'This is a secret message from headquarters.';
    const result = mask(text);
    // "secret" followed by a space (not = or :) should NOT trigger
    expect(result.text).toBe(text);
  });

  it('does not mask "secret" at end of sentence', () => {
    const text = 'The recipe is a closely guarded secret.';
    const result = mask(text);
    expect(result.text).toBe(text);
  });

  it('does not mask normal HTTPS URLs', () => {
    const text = 'Visit https://example.com for more info.';
    const result = mask(text);
    expect(result.text).toBe(text);
  });

  it('does not mask short sk- like "sketch"', () => {
    const text = 'I made a quick sk-etch of the design';
    const result = mask(text);
    expect(result.text).toBe(text);
  });

  it('does not mask normal file paths', () => {
    const text = '/Users/john/Documents/project/src/index.ts';
    const result = mask(text);
    expect(result.text).toBe(text);
  });

  it('does not mask a non-sensitive export', () => {
    const text = 'export PATH=/usr/local/bin:/usr/bin';
    const result = mask(text);
    expect(result.text).toBe(text);
  });

  it('does not mask http:// URLs that are not DB connection strings', () => {
    const text = 'http://localhost:3000/api/health';
    const result = mask(text);
    expect(result.text).toBe(text);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('handles very long strings without hanging (no catastrophic backtracking)', () => {
    // 100 KB of random-ish safe text
    const longText = 'a'.repeat(100_000);
    const start = performance.now();
    const result = mask(longText);
    const elapsed = performance.now() - start;
    expect(result.text).toBe(longText);
    // Should complete well under 1 second
    expect(elapsed).toBeLessThan(1000);
  });

  it('handles text with special regex characters safely', () => {
    const text = 'price is $100.00 (USD) [confirmed] {done} ^start end$';
    const result = mask(text);
    expect(result.text).toBe(text);
  });

  it('handles multiline text with private key and surrounding content', () => {
    const text = `config:
-----BEGIN RSA PRIVATE KEY-----
base64encodeddata==
-----END RSA PRIVATE KEY-----
more config`;
    const result = mask(text);
    expect(result.text).toContain('config:');
    expect(result.text).toContain('more config');
    expect(result.text).not.toContain('BEGIN RSA PRIVATE KEY');
  });

  it('handles unicode text', () => {
    const text = 'Mot de passe: hunter2 -- securite maximale';
    const result = mask(text);
    // French "passe:" does not match our English-oriented patterns
    expect(result.text).toBe(text);
  });
});

// ---------------------------------------------------------------------------
// createRegexMasker factory
// ---------------------------------------------------------------------------

describe('createRegexMasker', () => {
  it('returns a function', () => {
    const masker = createRegexMasker();
    expect(typeof masker).toBe('function');
  });

  it('produced function masks text using default rules', () => {
    const masker = createRegexMasker();
    const result = masker('sk-abcdefghijklmnopqrstuvwxyz');
    expect(result.text).toBe('***');
    expect(result.appliedRules).toContain('openai-api-key');
    expect(result.totalReplacements).toBe(1);
  });

  it('produced function is deterministic across invocations', () => {
    const masker = createRegexMasker();
    const input = 'password="SuperSecret123!"';
    const a = masker(input);
    const b = masker(input);
    expect(a.text).toBe(b.text);
    expect(a.appliedRules).toEqual(b.appliedRules);
    expect(a.totalReplacements).toBe(b.totalReplacements);
  });

  it('clean text passes through unchanged', () => {
    const masker = createRegexMasker();
    const input = 'Just a normal log line with no secrets.';
    const result = masker(input);
    expect(result.text).toBe(input);
    expect(result.appliedRules).toEqual([]);
    expect(result.totalReplacements).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_MASKING_RULES structure
// ---------------------------------------------------------------------------

describe('DEFAULT_MASKING_RULES', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(DEFAULT_MASKING_RULES)).toBe(true);
    expect(DEFAULT_MASKING_RULES.length).toBeGreaterThan(0);
  });

  it('every rule has the required shape', () => {
    for (const rule of DEFAULT_MASKING_RULES) {
      expect(typeof rule.name).toBe('string');
      expect(rule.name.length).toBeGreaterThan(0);
      expect(rule.pattern).toBeInstanceOf(RegExp);
      expect(typeof rule.replacement).toBe('string');
    }
  });

  it('all rules use "***" as replacement', () => {
    for (const rule of DEFAULT_MASKING_RULES) {
      expect(rule.replacement).toBe('***');
    }
  });

  it('all rules have the global flag set', () => {
    for (const rule of DEFAULT_MASKING_RULES) {
      expect(rule.pattern.flags).toContain('g');
    }
  });

  it('every rule has a unique name', () => {
    const names = DEFAULT_MASKING_RULES.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
