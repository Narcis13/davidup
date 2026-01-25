/**
 * API Types for Job Management
 *
 * Types for job storage and queue services.
 */

/**
 * Job status transitions: queued -> processing -> completed|failed
 */
export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

/**
 * Job result returned when job completes successfully
 */
export interface JobResult {
  download_url: string;
}

/**
 * Job entity stored in JobStore
 */
export interface Job {
  /** Unique job identifier */
  id: string;
  /** Current job status */
  status: JobStatus;
  /** Timestamp when job was created (ms since epoch) */
  created_at: number;
  /** Timestamp when job completed or failed (ms since epoch) */
  completed_at?: number;
  /** Optional webhook URL for job completion notification */
  webhook_url?: string;
  /** Progress percentage (0-100) during processing */
  progress?: number;
  /** Result data when job completes successfully */
  result?: JobResult;
  /** Error message when job fails */
  error?: string;
}
