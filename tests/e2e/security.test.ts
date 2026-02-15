import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSafeSender, type SafeSenderDeps } from '../../src/sanitize/outbound.js';
import { createDefaultPipeline } from '../../src/sanitize/pipeline.js';
import { createRegexMasker } from '../../src/sanitize/regex-masking.js';
import type { TelegramSender } from '../../src/telegram/sender.js';
import type { AuditWriter } from '../../src/audit/writer.js';
import type { ResponseEnvelope } from '../../src/types/envelope.js';

// ---- Helpers ----

function createMockInnerSender(): TelegramSender {
  return { sendResponse: vi.fn().mockResolvedValue(undefined), sendTypingIndicator: vi.fn().mockResolvedValue(undefined) };
}

function createMockAuditWriter(): AuditWriter {
  return {
    open: vi.fn().mockResolvedValue(undefined),
    write: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function createTestSafeSender(overrides?: Partial<SafeSenderDeps>) {
  const innerSender = createMockInnerSender();
  const auditWriter = createMockAuditWriter();
  const onSanitizeFailure = vi.fn();

  const safeSender = createSafeSender({
    innerSender,
    pipeline: createDefaultPipeline(),
    regexMasker: createRegexMasker(),
    auditWriter,
    onSanitizeFailure,
    ...overrides,
  });

  return { safeSender, innerSender, auditWriter, onSanitizeFailure };
}

function resultEnvelope(text: string): ResponseEnvelope {
  return { type: 'result', text, timestamp: new Date() };
}

function progressEnvelope(text: string): ResponseEnvelope {
  return { type: 'progress', text, timestamp: new Date() };
}

function errorEnvelope(message: string): ResponseEnvelope {
  return { type: 'error', code: 'INTERNAL_ERROR', message, timestamp: new Date() };
}

/** Extract the text field from what the inner sender received. */
function sentText(innerSender: TelegramSender, callIndex = 0): string {
  const call = (innerSender.sendResponse as ReturnType<typeof vi.fn>).mock.calls[callIndex];
  if (!call) return '';
  const envelope: ResponseEnvelope = call[1];
  if (envelope.type === 'result') return envelope.text;
  if (envelope.type === 'progress') return envelope.text;
  if (envelope.type === 'error') return envelope.message;
  return '';
}

// ---- Secret corpus ----

const SECRET_CORPUS = {
  openaiKey: 'sk-proj-abc123def456ghi789jkl012mno',
  openaiShort: 'sk-abcdefghijklmnopqrstuvwxyz',
  awsKey: 'AKIAIOSFODNN7EXAMPLE',
  genericKey: 'key-abcdefghijklmnopqrstuvwxyz',
  bearerToken: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0',
  postgresConn: 'postgres://admin:secretpass@db.example.com:5432/mydb',
  mongoConn: 'mongodb://user:pass@mongo.example.com:27017/prod',
  redisConn: 'redis://default:password123@redis.example.com:6379',
  mysqlConn: 'mysql://root:hunter2@mysql.host.com/app',
  pemKey: '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Z3VS5JJcds3xfn/yGaX\n-----END RSA PRIVATE KEY-----',
  envLeak: 'export SECRET_KEY=supersecretvalue123',
  password: 'password=hunter2',
  passwd: 'passwd:mysecretpw',
  secretAssign: 'secret=my-ultra-secret-value',
  tokenAssign: 'token=abcdefghijklmnopqrstuvwxyz1234',
  sensitivePath: '/Users/john/.ssh/id_rsa',
  awsPath: '/Users/john/.aws/credentials',
};

// ---- Tests ----

describe('e2e: outbound sanitization security', () => {
  describe('API key masking', () => {
    it('masks OpenAI project key', async () => {
      const { safeSender, innerSender } = createTestSafeSender();
      await safeSender.sendResponse(1, resultEnvelope(`Your key is ${SECRET_CORPUS.openaiKey}`));
      expect(sentText(innerSender)).not.toContain(SECRET_CORPUS.openaiKey);
    });

    it('masks OpenAI-style key', async () => {
      const { safeSender, innerSender } = createTestSafeSender();
      await safeSender.sendResponse(1, resultEnvelope(`Key: ${SECRET_CORPUS.openaiShort}`));
      expect(sentText(innerSender)).not.toContain(SECRET_CORPUS.openaiShort);
    });

    it('masks AWS access key ID', async () => {
      const { safeSender, innerSender } = createTestSafeSender();
      await safeSender.sendResponse(1, resultEnvelope(`AWS: ${SECRET_CORPUS.awsKey}`));
      expect(sentText(innerSender)).not.toContain(SECRET_CORPUS.awsKey);
    });

    it('masks generic key-prefixed token', async () => {
      const { safeSender, innerSender } = createTestSafeSender();
      await safeSender.sendResponse(1, resultEnvelope(`API: ${SECRET_CORPUS.genericKey}`));
      expect(sentText(innerSender)).not.toContain(SECRET_CORPUS.genericKey);
    });
  });

  describe('connection string masking', () => {
    for (const [name, value] of [
      ['PostgreSQL', SECRET_CORPUS.postgresConn],
      ['MongoDB', SECRET_CORPUS.mongoConn],
      ['Redis', SECRET_CORPUS.redisConn],
      ['MySQL', SECRET_CORPUS.mysqlConn],
    ] as const) {
      it(`masks ${name} connection string`, async () => {
        const { safeSender, innerSender } = createTestSafeSender();
        await safeSender.sendResponse(1, resultEnvelope(`DB: ${value}`));
        expect(sentText(innerSender)).not.toContain(value);
      });
    }
  });

  describe('PEM private key masking', () => {
    it('masks entire PEM block', async () => {
      const { safeSender, innerSender } = createTestSafeSender();
      await safeSender.sendResponse(1, resultEnvelope(`Here:\n${SECRET_CORPUS.pemKey}`));
      const output = sentText(innerSender);
      expect(output).not.toContain('BEGIN RSA PRIVATE KEY');
      expect(output).not.toContain('MIIEowIBAAKCAQEA0Z3VS5JJcds3xfn');
    });
  });

  describe('bearer token masking', () => {
    it('masks Authorization bearer token', async () => {
      const { safeSender, innerSender } = createTestSafeSender();
      await safeSender.sendResponse(1, resultEnvelope(`Auth: ${SECRET_CORPUS.bearerToken}`));
      expect(sentText(innerSender)).not.toContain('eyJhbGciOiJIUzI1NiI');
    });
  });

  describe('environment variable leak masking', () => {
    it('masks export SECRET_KEY=...', async () => {
      const { safeSender, innerSender } = createTestSafeSender();
      await safeSender.sendResponse(1, resultEnvelope(SECRET_CORPUS.envLeak));
      expect(sentText(innerSender)).not.toContain('supersecretvalue123');
    });
  });

  describe('password and secret masking', () => {
    it('masks password=value', async () => {
      const { safeSender, innerSender } = createTestSafeSender();
      await safeSender.sendResponse(1, resultEnvelope(`Config: ${SECRET_CORPUS.password}`));
      expect(sentText(innerSender)).not.toContain('hunter2');
    });

    it('masks passwd:value', async () => {
      const { safeSender, innerSender } = createTestSafeSender();
      await safeSender.sendResponse(1, resultEnvelope(SECRET_CORPUS.passwd));
      expect(sentText(innerSender)).not.toContain('mysecretpw');
    });

    it('masks secret=value', async () => {
      const { safeSender, innerSender } = createTestSafeSender();
      await safeSender.sendResponse(1, resultEnvelope(SECRET_CORPUS.secretAssign));
      expect(sentText(innerSender)).not.toContain('my-ultra-secret-value');
    });

    it('masks token=value', async () => {
      const { safeSender, innerSender } = createTestSafeSender();
      await safeSender.sendResponse(1, resultEnvelope(`Tok: ${SECRET_CORPUS.tokenAssign}`));
      expect(sentText(innerSender)).not.toContain('abcdefghijklmnopqrstuvwxyz1234');
    });
  });

  describe('sensitive path masking', () => {
    it('masks ~/.ssh path', async () => {
      const { safeSender, innerSender } = createTestSafeSender();
      await safeSender.sendResponse(1, resultEnvelope(`File: ${SECRET_CORPUS.sensitivePath}`));
      expect(sentText(innerSender)).not.toContain('.ssh/id_rsa');
    });

    it('masks ~/.aws path', async () => {
      const { safeSender, innerSender } = createTestSafeSender();
      await safeSender.sendResponse(1, resultEnvelope(`Creds: ${SECRET_CORPUS.awsPath}`));
      expect(sentText(innerSender)).not.toContain('.aws/credentials');
    });
  });

  describe('deterministic masking', () => {
    it('produces identical output for the same input', async () => {
      const { safeSender, innerSender } = createTestSafeSender();
      const input = `Key: ${SECRET_CORPUS.openaiKey} and ${SECRET_CORPUS.postgresConn}`;

      await safeSender.sendResponse(1, resultEnvelope(input));
      await safeSender.sendResponse(1, resultEnvelope(input));

      const first = sentText(innerSender, 0);
      const second = sentText(innerSender, 1);
      expect(first).toBe(second);
      expect(first).not.toContain(SECRET_CORPUS.openaiKey);
    });
  });

  describe('mixed content', () => {
    it('preserves normal text while masking embedded secrets', async () => {
      const { safeSender, innerSender } = createTestSafeSender();
      const input = `Here is a normal sentence. Your key is ${SECRET_CORPUS.openaiKey}. Have a nice day!`;

      await safeSender.sendResponse(1, resultEnvelope(input));
      const output = sentText(innerSender);

      expect(output).toContain('Here is a normal sentence.');
      expect(output).toContain('Have a nice day!');
      expect(output).not.toContain(SECRET_CORPUS.openaiKey);
    });
  });

  describe('sanitization pipeline failure', () => {
    it('blocks message and sends generic error when pipeline throws', async () => {
      const brokenPipeline = {
        sanitize: vi.fn().mockImplementation(() => {
          throw new Error('pipeline exploded');
        }),
      };
      const { safeSender, innerSender, auditWriter, onSanitizeFailure } = createTestSafeSender({
        pipeline: brokenPipeline as any,
      });

      await safeSender.sendResponse(1, resultEnvelope('This has secrets'));

      // Callback invoked
      expect(onSanitizeFailure).toHaveBeenCalled();

      // Inner sender receives generic error, NOT the original text
      const call = (innerSender.sendResponse as ReturnType<typeof vi.fn>).mock.calls[0];
      const envelope: ResponseEnvelope = call[1];
      expect(envelope.type).toBe('error');
      if (envelope.type === 'error') {
        expect(envelope.message).toContain('safety filter');
      }

      // Original text was NOT sent
      expect(sentText(innerSender)).not.toContain('This has secrets');

      // Audit records SANITIZE_FAILURE
      expect(auditWriter.write).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'error_occurred', errorCode: 'SANITIZE_FAILURE' }),
      );
    });
  });

  describe('envelope type coverage', () => {
    it('sanitizes result envelope text', async () => {
      const { safeSender, innerSender } = createTestSafeSender();
      await safeSender.sendResponse(1, resultEnvelope(SECRET_CORPUS.openaiKey));
      expect(sentText(innerSender)).not.toContain(SECRET_CORPUS.openaiKey);
    });

    it('sanitizes progress envelope text', async () => {
      const { safeSender, innerSender } = createTestSafeSender();
      await safeSender.sendResponse(1, progressEnvelope(SECRET_CORPUS.postgresConn));
      expect(sentText(innerSender)).not.toContain(SECRET_CORPUS.postgresConn);
    });

    it('sanitizes error envelope message', async () => {
      const { safeSender, innerSender } = createTestSafeSender();
      await safeSender.sendResponse(1, errorEnvelope(`Error: ${SECRET_CORPUS.password}`));
      expect(sentText(innerSender)).not.toContain('hunter2');
    });

    it('passes ack envelope through unchanged', async () => {
      const { safeSender, innerSender } = createTestSafeSender();
      const ack: ResponseEnvelope = { type: 'ack', commandType: 'start_session', timestamp: new Date() };

      await safeSender.sendResponse(1, ack);

      const call = (innerSender.sendResponse as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1].type).toBe('ack');
    });

    it('passes status envelope through unchanged', async () => {
      const { safeSender, innerSender } = createTestSafeSender();
      const status: ResponseEnvelope = {
        type: 'status',
        sessionActive: true,
        sessionId: 'sess-001',
        state: 'active',
        locked: true,
        timestamp: new Date(),
      };

      await safeSender.sendResponse(1, status);

      const call = (innerSender.sendResponse as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1].type).toBe('status');
      if (call[1].type === 'status') {
        expect(call[1].sessionId).toBe('sess-001');
      }
    });
  });

  describe('audit logging of redactions', () => {
    it('writes output_sanitized event when redactions occur', async () => {
      const { safeSender, auditWriter } = createTestSafeSender();
      await safeSender.sendResponse(1, resultEnvelope(`Key: ${SECRET_CORPUS.openaiKey}`));

      expect(auditWriter.write).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'output_sanitized',
          redactionCount: expect.any(Number),
        }),
      );
    });

    it('does not write output_sanitized for clean text', async () => {
      const { safeSender, auditWriter } = createTestSafeSender();
      await safeSender.sendResponse(1, resultEnvelope('Hello world, nothing secret here.'));

      expect(auditWriter.write).not.toHaveBeenCalled();
    });
  });
});
