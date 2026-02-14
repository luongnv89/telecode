import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSessionDiscovery, type SessionDiscovery } from '../../src/session/discovery.js';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('SessionDiscovery', () => {
  let tempDir: string;
  let discovery: SessionDiscovery;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `telecode-discovery-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    discovery = createSessionDiscovery(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('returns empty array when projects dir is empty', async () => {
    const results = await discovery.scan();
    expect(results).toEqual([]);
  });

  it('returns empty array when projects dir does not exist', async () => {
    const d = createSessionDiscovery('/tmp/nonexistent-discovery-test');
    const results = await d.scan();
    expect(results).toEqual([]);
  });

  it('discovers UUID-named .jsonl files in project dirs', async () => {
    const projectDir = join(tempDir, '-Users-test-project');
    await fs.mkdir(projectDir, { recursive: true });

    const sessionFile = join(projectDir, '12345678-1234-1234-1234-123456789abc.jsonl');
    await fs.writeFile(sessionFile, '{"test": true}\n', 'utf-8');

    const results = await discovery.scan();
    expect(results).toHaveLength(1);
    expect(results[0].claudeSessionId).toBe('12345678-1234-1234-1234-123456789abc');
    expect(results[0].projectPath).toBe('/Users/test/project');
    expect(results[0].fileName).toBe('12345678-1234-1234-1234-123456789abc.jsonl');
  });

  it('ignores non-UUID files', async () => {
    const projectDir = join(tempDir, '-Users-test-project');
    await fs.mkdir(projectDir, { recursive: true });

    await fs.writeFile(join(projectDir, 'not-a-uuid.jsonl'), 'data\n');
    await fs.writeFile(join(projectDir, 'config.json'), 'data\n');

    const results = await discovery.scan();
    expect(results).toEqual([]);
  });

  it('filters out sessions older than maxAgeMs', async () => {
    const projectDir = join(tempDir, '-Users-test-project');
    await fs.mkdir(projectDir, { recursive: true });

    const sessionFile = join(projectDir, '12345678-1234-1234-1234-123456789abc.jsonl');
    await fs.writeFile(sessionFile, 'data\n');

    // Set mtime to 48 hours ago
    const oldTime = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await fs.utimes(sessionFile, oldTime, oldTime);

    const results = await discovery.scan(24 * 60 * 60 * 1000); // 24h
    expect(results).toEqual([]);
  });

  it('discovers sessions within maxAgeMs', async () => {
    const projectDir = join(tempDir, '-Users-test-project');
    await fs.mkdir(projectDir, { recursive: true });

    const sessionFile = join(projectDir, '12345678-1234-1234-1234-123456789abc.jsonl');
    await fs.writeFile(sessionFile, 'data\n');

    const results = await discovery.scan(24 * 60 * 60 * 1000);
    expect(results).toHaveLength(1);
  });

  it('sorts results by most recently modified first', async () => {
    const projectDir = join(tempDir, '-Users-test-project');
    await fs.mkdir(projectDir, { recursive: true });

    const older = join(projectDir, '11111111-1111-1111-1111-111111111111.jsonl');
    const newer = join(projectDir, '22222222-2222-2222-2222-222222222222.jsonl');

    await fs.writeFile(older, 'data\n');
    const olderTime = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
    await fs.utimes(older, olderTime, olderTime);

    await fs.writeFile(newer, 'data\n');

    const results = await discovery.scan();
    expect(results).toHaveLength(2);
    expect(results[0].claudeSessionId).toBe('22222222-2222-2222-2222-222222222222');
    expect(results[1].claudeSessionId).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('discovers sessions across multiple project directories', async () => {
    const dir1 = join(tempDir, '-Users-test-project1');
    const dir2 = join(tempDir, '-Users-test-project2');
    await fs.mkdir(dir1, { recursive: true });
    await fs.mkdir(dir2, { recursive: true });

    await fs.writeFile(join(dir1, '11111111-1111-1111-1111-111111111111.jsonl'), 'data\n');
    await fs.writeFile(join(dir2, '22222222-2222-2222-2222-222222222222.jsonl'), 'data\n');

    const results = await discovery.scan();
    expect(results).toHaveLength(2);
  });
});
