/**
 * JobStore - In-memory job storage with TTL cleanup
 *
 * Manages job lifecycle: queued -> processing -> completed|failed
 * Provides automatic cleanup of expired jobs based on TTL.
 */
import type { Job } from '../types.js';

const DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24 hours

export class JobStore {
  private jobs = new Map<string, Job>();
  private ttl: number;

  /**
   * Create a new JobStore instance
   * @param ttl Time-to-live in milliseconds (default: 24 hours)
   */
  constructor(ttl = DEFAULT_TTL) {
    this.ttl = ttl;
  }

  /**
   * Store a new job
   * @param job Job to store
   */
  create(job: Job): void {
    this.jobs.set(job.id, job);
  }

  /**
   * Retrieve a job by ID
   * @param id Job ID
   * @returns Job or undefined if not found
   */
  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  /**
   * Update an existing job with partial updates
   * @param id Job ID
   * @param updates Partial job updates to merge
   */
  update(id: string, updates: Partial<Job>): void {
    const existing = this.jobs.get(id);
    if (existing) {
      this.jobs.set(id, { ...existing, ...updates });
    }
  }

  /**
   * Delete a job by ID
   * @param id Job ID
   */
  delete(id: string): void {
    this.jobs.delete(id);
  }

  /**
   * Remove jobs older than TTL
   * Called periodically to free memory
   */
  cleanup(): void {
    const now = Date.now();
    for (const [id, job] of this.jobs) {
      if (now - job.created_at > this.ttl) {
        this.jobs.delete(id);
      }
    }
  }

  /**
   * Get the number of stored jobs
   */
  get size(): number {
    return this.jobs.size;
  }
}
