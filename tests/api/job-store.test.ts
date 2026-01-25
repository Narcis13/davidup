import { describe, it, expect, beforeEach } from 'vitest';
// Import will fail initially - that's expected
import { JobStore } from '../../src/api/services/job-store.js';
import type { Job } from '../../src/api/types.js';

describe('JobStore', () => {
  let store: JobStore;

  beforeEach(() => {
    store = new JobStore();
  });

  describe('create and get', () => {
    it('should store and retrieve a job by ID', () => {
      const job: Job = {
        id: 'job-1',
        status: 'queued',
        created_at: Date.now(),
      };
      store.create(job);
      expect(store.get('job-1')).toEqual(job);
    });

    it('should return undefined for non-existent job', () => {
      expect(store.get('non-existent')).toBeUndefined();
    });
  });

  describe('update', () => {
    it('should merge partial updates into existing job', () => {
      const job: Job = {
        id: 'job-1',
        status: 'queued',
        created_at: Date.now(),
      };
      store.create(job);
      store.update('job-1', { status: 'processing', progress: 50 });

      const updated = store.get('job-1');
      expect(updated?.status).toBe('processing');
      expect(updated?.progress).toBe(50);
      expect(updated?.id).toBe('job-1'); // Original fields preserved
    });

    it('should do nothing for non-existent job', () => {
      store.update('non-existent', { status: 'processing' });
      expect(store.get('non-existent')).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('should remove job by ID', () => {
      const job: Job = { id: 'job-1', status: 'queued', created_at: Date.now() };
      store.create(job);
      store.delete('job-1');
      expect(store.get('job-1')).toBeUndefined();
    });
  });

  describe('cleanup', () => {
    it('should remove jobs older than TTL', () => {
      const oldStore = new JobStore(1000); // 1 second TTL
      const oldJob: Job = {
        id: 'old-job',
        status: 'completed',
        created_at: Date.now() - 2000, // 2 seconds ago
      };
      const freshJob: Job = {
        id: 'fresh-job',
        status: 'queued',
        created_at: Date.now(),
      };

      oldStore.create(oldJob);
      oldStore.create(freshJob);
      oldStore.cleanup();

      expect(oldStore.get('old-job')).toBeUndefined();
      expect(oldStore.get('fresh-job')).toBeDefined();
    });
  });

  describe('size', () => {
    it('should return number of stored jobs', () => {
      expect(store.size).toBe(0);
      store.create({ id: 'job-1', status: 'queued', created_at: Date.now() });
      expect(store.size).toBe(1);
      store.create({ id: 'job-2', status: 'queued', created_at: Date.now() });
      expect(store.size).toBe(2);
    });
  });
});
