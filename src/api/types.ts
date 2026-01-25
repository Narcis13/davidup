/**
 * API type definitions for the GameMotion rendering API.
 * Defines Job, RenderRequest, ApiKey, and response structures.
 */

import type { VideoSpec } from '../types/index.js';

/**
 * Job status transitions: queued -> processing -> completed|failed
 */
export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

/**
 * API key plan tiers
 */
export type PlanTier = 'free' | 'pro';

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

/**
 * Request to render a video
 */
export interface RenderRequest {
  /** Video specification to render */
  spec: VideoSpec;
  /** Optional webhook URL for completion notification */
  webhook_url?: string;
  /** If true, wait for completion and return video inline (for short videos) */
  sync?: boolean;
}

/**
 * API key with user association and plan tier
 */
export interface ApiKey {
  /** The API key string */
  key: string;
  /** Associated user ID */
  userId: string;
  /** Plan tier determining rate limits and features */
  plan: PlanTier;
}

/**
 * Response when a render job is created
 */
export interface RenderResponse {
  /** The job ID for polling status */
  job_id: string;
  /** Initial job status */
  status: JobStatus;
  /** URL to poll for job status */
  poll_url: string;
}

/**
 * Error response format
 */
export interface ErrorResponse {
  /** Human-readable error message */
  error: string;
  /** Field-specific validation errors (for 400 responses) */
  fieldErrors?: Record<string, string[]>;
}

/**
 * Health check response
 */
export interface HealthResponse {
  status: 'ok';
  timestamp: string;
}

/**
 * Re-export VideoSpec for API consumers
 */
export type { VideoSpec } from '../types/index.js';
