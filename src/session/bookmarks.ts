import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

export interface Bookmark {
  name: string;
  path: string;
  createdAt: string;
}

export interface BookmarkStore {
  add(name: string, path: string): void;
  remove(name: string): boolean;
  get(name: string): Bookmark | undefined;
  list(): Bookmark[];
  save(): Promise<void>;
  load(): Promise<void>;
}

export function createBookmarkStore(filePath: string): BookmarkStore {
  const bookmarks = new Map<string, Bookmark>();

  return {
    add(name: string, path: string): void {
      bookmarks.set(name.toLowerCase(), {
        name,
        path,
        createdAt: new Date().toISOString(),
      });
    },

    remove(name: string): boolean {
      return bookmarks.delete(name.toLowerCase());
    },

    get(name: string): Bookmark | undefined {
      return bookmarks.get(name.toLowerCase());
    },

    list(): Bookmark[] {
      return Array.from(bookmarks.values());
    },

    async save(): Promise<void> {
      try {
        const dir = dirname(filePath);
        await fs.mkdir(dir, { recursive: true });
        const data = JSON.stringify(Array.from(bookmarks.values()), null, 2);
        await fs.writeFile(filePath, data, 'utf-8');
      } catch (err) {
        console.error(`[bookmarks] Failed to save: ${err}`);
      }
    },

    async load(): Promise<void> {
      try {
        const json = await fs.readFile(filePath, 'utf-8');
        const entries = JSON.parse(json) as Bookmark[];
        bookmarks.clear();
        for (const entry of entries) {
          bookmarks.set(entry.name.toLowerCase(), entry);
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          return; // No file yet — that's fine
        }
        console.error(`[bookmarks] Failed to load: ${err}`);
      }
    },
  };
}
