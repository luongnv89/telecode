import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBookmarkStore, type BookmarkStore } from '../../src/session/bookmarks.js';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('BookmarkStore', () => {
  let store: BookmarkStore;
  let filePath: string;

  beforeEach(() => {
    filePath = join(tmpdir(), `telecode-test-bookmarks-${Date.now()}.json`);
    store = createBookmarkStore(filePath);
  });

  afterEach(async () => {
    try {
      await fs.unlink(filePath);
    } catch {
      // Ignore if file doesn't exist
    }
  });

  describe('add/get', () => {
    it('adds and retrieves a bookmark', () => {
      store.add('api', '/projects/api');
      const bookmark = store.get('api');
      expect(bookmark).toBeDefined();
      expect(bookmark!.name).toBe('api');
      expect(bookmark!.path).toBe('/projects/api');
      expect(bookmark!.createdAt).toBeDefined();
    });

    it('retrieves bookmarks case-insensitively', () => {
      store.add('MyProject', '/projects/myproject');
      expect(store.get('myproject')).toBeDefined();
      expect(store.get('MYPROJECT')).toBeDefined();
      expect(store.get('MyProject')).toBeDefined();
    });

    it('overwrites bookmark with same name', () => {
      store.add('api', '/old/path');
      store.add('api', '/new/path');
      expect(store.get('api')!.path).toBe('/new/path');
    });

    it('returns undefined for non-existent bookmark', () => {
      expect(store.get('nonexistent')).toBeUndefined();
    });
  });

  describe('remove', () => {
    it('removes an existing bookmark', () => {
      store.add('api', '/projects/api');
      const removed = store.remove('api');
      expect(removed).toBe(true);
      expect(store.get('api')).toBeUndefined();
    });

    it('returns false for non-existent bookmark', () => {
      expect(store.remove('nonexistent')).toBe(false);
    });
  });

  describe('list', () => {
    it('returns empty array when no bookmarks', () => {
      expect(store.list()).toEqual([]);
    });

    it('returns all bookmarks', () => {
      store.add('api', '/projects/api');
      store.add('web', '/projects/web');
      const list = store.list();
      expect(list).toHaveLength(2);
      expect(list.map(b => b.name)).toContain('api');
      expect(list.map(b => b.name)).toContain('web');
    });
  });

  describe('save/load', () => {
    it('persists bookmarks to disk and reloads them', async () => {
      store.add('api', '/projects/api');
      store.add('web', '/projects/web');
      await store.save();

      const store2 = createBookmarkStore(filePath);
      await store2.load();
      expect(store2.list()).toHaveLength(2);
      expect(store2.get('api')!.path).toBe('/projects/api');
      expect(store2.get('web')!.path).toBe('/projects/web');
    });

    it('load handles missing file gracefully', async () => {
      const store2 = createBookmarkStore('/tmp/nonexistent-bookmarks-test.json');
      await store2.load(); // should not throw
      expect(store2.list()).toEqual([]);
    });
  });
});
