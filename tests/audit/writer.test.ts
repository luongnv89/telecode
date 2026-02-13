import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createAuditWriter } from '../../src/audit/writer.js';
import { sessionStarted, commandReceived } from '../../src/audit/schema.js';
import { readFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('AuditWriter', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'telecode-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('creates log file on open', async () => {
    const writer = createAuditWriter(tempDir);
    await writer.open('sess-1', new Date('2026-02-13T14:30:22'));
    await writer.close();

    // File should exist (we wrote nothing, but it was created)
    const files = await import('node:fs/promises').then((fs) =>
      fs.readdir(tempDir)
    );
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^session-.*\.jsonl$/);
  });

  it('writes JSONL events', async () => {
    const writer = createAuditWriter(tempDir);
    await writer.open('sess-1', new Date('2026-02-13T14:30:22'));

    const event = sessionStarted({
      sessionId: 'sess-1',
      userId: 42,
      chatId: 100,
    });
    await writer.write(event);
    await writer.close();

    const files = await import('node:fs/promises').then((fs) =>
      fs.readdir(tempDir)
    );
    const content = await readFile(join(tempDir, files[0]), 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.event).toBe('session_started');
    expect(parsed.sessionId).toBe('sess-1');
  });

  it('writes multiple events as separate lines', async () => {
    const writer = createAuditWriter(tempDir);
    await writer.open('sess-1', new Date());

    await writer.write(
      sessionStarted({ sessionId: 'sess-1', userId: 42, chatId: 100 })
    );
    await writer.write(
      commandReceived({
        sessionId: 'sess-1',
        userId: 42,
        chatId: 100,
        commandType: 'send',
        rawText: '/send hello',
      })
    );
    await writer.close();

    const files = await import('node:fs/promises').then((fs) =>
      fs.readdir(tempDir)
    );
    const content = await readFile(join(tempDir, files[0]), 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);

    expect(JSON.parse(lines[0]).event).toBe('session_started');
    expect(JSON.parse(lines[1]).event).toBe('command_received');
  });

  it('throws if write is called before open', async () => {
    const writer = createAuditWriter(tempDir);
    const event = sessionStarted({
      sessionId: 'sess-1',
      userId: 42,
      chatId: 100,
    });

    await expect(writer.write(event)).rejects.toThrow('not opened');
  });
});
