/**
 * JobQueueService - Queue manager for video rendering jobs
 *
 * Wraps p-queue for concurrency control and integrates with renderVideo.
 * Emits events for job lifecycle: processing, completed, failed.
 */
import { EventEmitter } from 'node:events';
import PQueue from 'p-queue';
import { renderVideo, type RenderResult } from '../../encoder/video-renderer.js';
import { JobStore } from './job-store.js';
import type { Job } from '../types.js';
import type { VideoSpec } from '../../types/index.js';
import type { AnimatedScene } from '../../render/animated-frame-generator.js';

/**
 * Render job submitted to the queue
 */
export interface RenderJob {
  /** Unique job identifier */
  id: string;
  /** Video specification from API request */
  spec: VideoSpec;
  /** Optional webhook URL for completion notification */
  webhookUrl?: string;
  /** User ID for job ownership */
  userId: string;
}

/**
 * Options for configuring the job queue
 */
export interface JobQueueOptions {
  /** Maximum concurrent jobs (default: 2) */
  concurrency?: number;
  /** Job timeout in milliseconds (default: 5 minutes) */
  timeout?: number;
}

/**
 * Events emitted by JobQueueService
 */
export interface JobQueueEvents {
  'job:processing': (jobId: string) => void;
  'job:completed': (jobId: string, result: RenderResult) => void;
  'job:failed': (jobId: string, error: Error) => void;
}

/**
 * JobQueueService manages video rendering job execution.
 *
 * Uses p-queue for concurrency control and JobStore for state.
 * Emits events for job lifecycle monitoring.
 */
export class JobQueueService extends EventEmitter {
  private queue: PQueue;
  private store: JobStore;

  /**
   * Create a new JobQueueService
   * @param store JobStore for job state management
   * @param options Queue configuration options
   */
  constructor(store: JobStore, options: JobQueueOptions = {}) {
    super();
    this.store = store;
    this.queue = new PQueue({
      concurrency: options.concurrency ?? 2,
      timeout: options.timeout ?? 5 * 60 * 1000, // 5 min default
    });
  }

  /**
   * Enqueue a render job for processing.
   *
   * Creates job in store with 'queued' status, then adds to queue.
   * Job status is updated as it progresses through the queue.
   *
   * @param renderJob Job to enqueue
   */
  async enqueue(renderJob: RenderJob): Promise<void> {
    // Create job record in store
    const job: Job = {
      id: renderJob.id,
      status: 'queued',
      created_at: Date.now(),
      webhook_url: renderJob.webhookUrl,
    };
    this.store.create(job);

    // Add to queue (fire and forget, status tracked in store)
    this.queue.add(async () => {
      // Update status to processing
      this.store.update(renderJob.id, { status: 'processing' });
      this.emit('job:processing', renderJob.id);

      try {
        const outputPath = `outputs/${renderJob.id}.mp4`;

        // Convert VideoSpec scenes to AnimatedScene format
        // The scenes from VideoSpec are compatible with AnimatedScene
        // as AnimatedScene is a superset that adds optional animation props
        const scenes = renderJob.spec.scenes as unknown as AnimatedScene[];

        const result = await renderVideo({
          scenes,
          width: renderJob.spec.output.width,
          height: renderJob.spec.output.height,
          fps: renderJob.spec.output.fps,
          outputPath,
        });

        // Update job with success result
        this.store.update(renderJob.id, {
          status: 'completed',
          result: { download_url: `/download/${renderJob.id}.mp4` },
          completed_at: Date.now(),
        });
        this.emit('job:completed', renderJob.id, result);
      } catch (error) {
        // Update job with failure
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.store.update(renderJob.id, {
          status: 'failed',
          error: errorMessage,
          completed_at: Date.now(),
        });
        this.emit('job:failed', renderJob.id, error instanceof Error ? error : new Error(errorMessage));
      }
    });
  }

  /**
   * Get a job by ID
   * @param id Job ID
   * @returns Job or undefined if not found
   */
  getJob(id: string): Job | undefined {
    return this.store.get(id);
  }

  /**
   * Get the number of jobs waiting in the queue
   */
  get size(): number {
    return this.queue.size;
  }

  /**
   * Get the number of jobs currently being processed
   */
  get pending(): number {
    return this.queue.pending;
  }

  /**
   * Wait for the queue to be empty and all jobs to complete
   * @returns Promise that resolves when queue is idle
   */
  onIdle(): Promise<void> {
    return this.queue.onIdle();
  }
}
