/**
 * Tests for AssetStore service.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import { AssetStore } from '../../src/api/services/asset-store.js';

describe('AssetStore', () => {
  let store: AssetStore;
  const testDir = './test-uploads';

  beforeEach(async () => {
    store = new AssetStore(testDir);
    await store.init();
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('save', () => {
    it('should save a valid image file', async () => {
      const asset = await store.save({
        userId: 'user-1',
        file: {
          name: 'test.png',
          type: 'image/png',
          data: Buffer.from('fake png data'),
        },
      });

      expect(asset.id).toBeDefined();
      expect(asset.mimeType).toBe('image/png');
      expect(asset.filename).toMatch(/\.png$/);
      expect(asset.originalName).toBe('test.png');
      expect(asset.userId).toBe('user-1');

      // File should exist
      const exists = await fs.access(asset.path).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should save a valid JPEG file', async () => {
      const asset = await store.save({
        userId: 'user-1',
        file: {
          name: 'photo.jpg',
          type: 'image/jpeg',
          data: Buffer.from('fake jpeg data'),
        },
      });

      expect(asset.mimeType).toBe('image/jpeg');
      expect(asset.filename).toMatch(/\.jpg$/);
    });

    it('should save a valid WebP file', async () => {
      const asset = await store.save({
        userId: 'user-1',
        file: {
          name: 'image.webp',
          type: 'image/webp',
          data: Buffer.from('fake webp data'),
        },
      });

      expect(asset.mimeType).toBe('image/webp');
      expect(asset.filename).toMatch(/\.webp$/);
    });

    it('should save a valid MP3 file (audio/mpeg)', async () => {
      const asset = await store.save({
        userId: 'user-1',
        file: {
          name: 'music.mp3',
          type: 'audio/mpeg',
          data: Buffer.from('fake mp3 data'),
        },
      });

      expect(asset.mimeType).toBe('audio/mpeg');
      expect(asset.filename).toMatch(/\.mp3$/);
    });

    it('should save a valid MP3 file (audio/mp3)', async () => {
      const asset = await store.save({
        userId: 'user-1',
        file: {
          name: 'music.mp3',
          type: 'audio/mp3',
          data: Buffer.from('fake mp3 data'),
        },
      });

      expect(asset.mimeType).toBe('audio/mp3');
      expect(asset.filename).toMatch(/\.mp3$/);
    });

    it('should save a valid WAV file', async () => {
      const asset = await store.save({
        userId: 'user-1',
        file: {
          name: 'audio.wav',
          type: 'audio/wav',
          data: Buffer.from('fake wav data'),
        },
      });

      expect(asset.mimeType).toBe('audio/wav');
      expect(asset.filename).toMatch(/\.wav$/);
    });

    it('should reject invalid file type', async () => {
      await expect(
        store.save({
          userId: 'user-1',
          file: {
            name: 'malware.exe',
            type: 'application/octet-stream',
            data: Buffer.from('evil'),
          },
        })
      ).rejects.toThrow('Invalid file type');
    });

    it('should reject text/html files', async () => {
      await expect(
        store.save({
          userId: 'user-1',
          file: {
            name: 'script.html',
            type: 'text/html',
            data: Buffer.from('<script>alert("xss")</script>'),
          },
        })
      ).rejects.toThrow('Invalid file type');
    });

    it('should reject files exceeding size limit', async () => {
      const largeData = Buffer.alloc(51 * 1024 * 1024); // 51MB

      await expect(
        store.save({
          userId: 'user-1',
          file: {
            name: 'huge.png',
            type: 'image/png',
            data: largeData,
          },
        })
      ).rejects.toThrow('File too large');
    });

    it('should accept file at exactly 50MB', async () => {
      const maxData = Buffer.alloc(50 * 1024 * 1024); // Exactly 50MB

      const asset = await store.save({
        userId: 'user-1',
        file: {
          name: 'max.png',
          type: 'image/png',
          data: maxData,
        },
      });

      expect(asset.size).toBe(50 * 1024 * 1024);
    });
  });

  describe('get', () => {
    it('should retrieve saved asset by ID', async () => {
      const saved = await store.save({
        userId: 'user-1',
        file: {
          name: 'test.png',
          type: 'image/png',
          data: Buffer.from('png data'),
        },
      });

      const retrieved = store.get(saved.id);
      expect(retrieved).toEqual(saved);
    });

    it('should return undefined for non-existent ID', () => {
      expect(store.get('non-existent')).toBeUndefined();
    });
  });

  describe('getPath', () => {
    it('should return path for saved asset', async () => {
      const saved = await store.save({
        userId: 'user-1',
        file: {
          name: 'test.png',
          type: 'image/png',
          data: Buffer.from('png data'),
        },
      });

      expect(store.getPath(saved.id)).toBe(saved.path);
    });

    it('should return undefined for non-existent ID', () => {
      expect(store.getPath('non-existent')).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('should delete asset and file', async () => {
      const saved = await store.save({
        userId: 'user-1',
        file: {
          name: 'test.png',
          type: 'image/png',
          data: Buffer.from('png data'),
        },
      });

      const deleted = await store.delete(saved.id);
      expect(deleted).toBe(true);
      expect(store.get(saved.id)).toBeUndefined();

      // File should be deleted
      const exists = await fs.access(saved.path).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    });

    it('should return false for non-existent asset', async () => {
      const deleted = await store.delete('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('static methods', () => {
    it('should return allowed types', () => {
      const types = AssetStore.getAllowedTypes();
      expect(types).toContain('image/png');
      expect(types).toContain('image/jpeg');
      expect(types).toContain('image/webp');
      expect(types).toContain('audio/mpeg');
      expect(types).toContain('audio/wav');
      expect(types).toContain('audio/mp3');
    });

    it('should return max size as 50MB', () => {
      expect(AssetStore.getMaxSize()).toBe(50 * 1024 * 1024);
    });
  });
});
