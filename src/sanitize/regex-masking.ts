/**
 * Deterministic regex fallback masking module.
 *
 * Acts as a secondary guardrail after the primary sanitizer,
 * catching any remaining sensitive patterns such as API keys,
 * tokens, passwords, private keys, connection strings, and more.
 */

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** A single masking rule: a named regex pattern with a fixed replacement string. */
export interface MaskingRule {
  name: string;
  pattern: RegExp;
  replacement: string;
}

/** The result returned after applying masking rules to a piece of text. */
export interface MaskingResult {
  /** The masked text. */
  text: string;
  /** Names of rules that matched at least once. */
  appliedRules: string[];
  /** Total number of individual replacements across all rules. */
  totalReplacements: number;
}

// ---------------------------------------------------------------------------
// Core masking function
// ---------------------------------------------------------------------------

/**
 * Apply an ordered list of masking rules to `text`.
 *
 * Rules are applied sequentially -- order matters because earlier rules may
 * transform the text seen by later rules.  The function is **deterministic**:
 * given the same `text` and `rules` it will always produce the same output.
 */
export function applyMaskingRules(
  text: string,
  rules: MaskingRule[],
): MaskingResult {
  const appliedRules: string[] = [];
  let totalReplacements = 0;
  let current = text;

  for (const rule of rules) {
    // Reset lastIndex for stateful (global) regexes so the function is
    // deterministic regardless of prior usage of the same RegExp object.
    rule.pattern.lastIndex = 0;

    let ruleCount = 0;
    current = current.replace(rule.pattern, () => {
      ruleCount++;
      return rule.replacement;
    });

    if (ruleCount > 0) {
      appliedRules.push(rule.name);
      totalReplacements += ruleCount;
    }
  }

  return { text: current, appliedRules, totalReplacements };
}

// ---------------------------------------------------------------------------
// Default rule set
// ---------------------------------------------------------------------------

/**
 * The built-in set of masking rules covering the most common categories of
 * sensitive data that may appear in CLI / code output.
 *
 * Categories (in application order):
 *  1. Private keys (PEM blocks)
 *  2. Connection strings
 *  3. AWS access key IDs
 *  4. OpenAI-style project API keys  (sk-proj-...)
 *  5. OpenAI-style API keys           (sk-...)
 *  6. Generic "key-..." tokens
 *  7. Bearer tokens
 *  8. Environment variable exports containing secrets
 *  9. Generic token assignments
 * 10. Password / secret assignments
 * 11. Sensitive file paths
 */
export const DEFAULT_MASKING_RULES: MaskingRule[] = [
  // 1. Private keys -- match the entire PEM block
  {
    name: 'private-key',
    pattern:
      /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g,
    replacement: '***',
  },

  // 2. Connection strings  (postgres, mysql, mongodb, redis)
  {
    name: 'connection-string',
    pattern: /(?:postgres|mysql|mongodb|redis):\/\/[^\s]+/g,
    replacement: '***',
  },

  // 3. AWS access key IDs  (always start with AKIA and have 16 uppercase-alphanumeric chars)
  {
    name: 'aws-access-key',
    pattern: /AKIA[0-9A-Z]{16}/g,
    replacement: '***',
  },

  // 4. OpenAI project-scoped keys  (sk-proj-...)
  {
    name: 'openai-project-key',
    pattern: /sk-proj-[a-zA-Z0-9_-]{20,}/g,
    replacement: '***',
  },

  // 5. OpenAI-style secret keys  (sk-...)
  {
    name: 'openai-api-key',
    pattern: /sk-[a-zA-Z0-9]{20,}/g,
    replacement: '***',
  },

  // 6. Generic "key-" prefixed secrets
  {
    name: 'generic-key',
    pattern: /key-[a-zA-Z0-9]{20,}/g,
    replacement: '***',
  },

  // 7. Bearer tokens in authorization headers
  {
    name: 'bearer-token',
    pattern: /Bearer [A-Za-z0-9\-._~+/]+=*/g,
    replacement: '***',
  },

  // 8. Environment variable exports that contain secret-like values
  //    Matches when the variable name OR the assigned value contains a
  //    sensitive keyword (key, secret, token, password).
  //    Must come BEFORE password/secret/token rules so the full export
  //    line is matched before individual value rules consume parts of it.
  {
    name: 'env-variable-leak',
    pattern:
      /export [A-Z_]*(?:KEY|SECRET|TOKEN|PASSWORD)[A-Z_]*=\S+/gi,
    replacement: '***',
  },

  // 9. Generic token assignments  (token=..., token: ...)
  {
    name: 'generic-token',
    pattern: /token[=:]\s*["']?[A-Za-z0-9\-._~+/]{20,}["']?/gi,
    replacement: '***',
  },

  // 10. Password / passwd / secret assignments
  //     Separator is = or : (optionally followed by whitespace).
  //     A bare space is NOT a valid separator to avoid false positives on
  //     prose like "reset your password using the link".
  {
    name: 'password-string',
    pattern: /password[=:]\s*["']?[^\s"']{4,}["']?/gi,
    replacement: '***',
  },
  {
    name: 'passwd-string',
    pattern: /passwd[=:]\s*["']?[^\s"']{4,}["']?/gi,
    replacement: '***',
  },
  {
    name: 'secret-string',
    pattern: /secret[=:]\s*["']?[^\s"']{4,}["']?/gi,
    replacement: '***',
  },

  // 11. Sensitive file paths (Unix home-directory dotfiles)
  {
    name: 'sensitive-path',
    pattern:
      /\/Users\/[a-zA-Z0-9._-]+\/(?:\.ssh|\.aws|\.gnupg|\.config|\.env)[^\s]*/g,
    replacement: '***',
  },
];

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a masker function pre-loaded with the default rule set.
 *
 * ```ts
 * const mask = createRegexMasker();
 * const result = mask('Authorization: Bearer eyJhb...');
 * ```
 */
export function createRegexMasker(): (text: string) => MaskingResult {
  return (text: string) => applyMaskingRules(text, DEFAULT_MASKING_RULES);
}
