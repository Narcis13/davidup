/**
 * Global error handler middleware for Hono app.
 * Handles HTTPException, ZodError, and generic errors consistently.
 */

import type { Context, ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import type { ErrorResponse } from '../types.js';

/**
 * Parse Zod issues into field-specific error messages.
 * @param issues Zod validation issues
 * @returns Map of field paths to error messages
 */
function parseZodIssues(issues: ZodError['issues']): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of issues) {
    const path = issue.path.join('.') || 'root';
    if (!fieldErrors[path]) {
      fieldErrors[path] = [];
    }
    fieldErrors[path].push(issue.message);
  }

  return fieldErrors;
}

/**
 * Global error handler for Hono app.
 * - HTTPException: Returns JSON with error message and status
 * - ZodError: Returns 400 with fieldErrors
 * - Generic Error: Logs and returns 500
 */
export const errorHandler: ErrorHandler = (error: Error, c: Context) => {
  // HTTPException from hono/http-exception - convert to JSON
  if (error instanceof HTTPException) {
    const response: ErrorResponse = {
      error: error.message,
    };
    return c.json(response, error.status);
  }

  // ZodError from validation - return 400 with field-specific errors
  if (error instanceof ZodError) {
    const response: ErrorResponse = {
      error: 'Validation failed',
      fieldErrors: parseZodIssues(error.issues),
    };
    return c.json(response, 400);
  }

  // Generic errors - log and return 500
  console.error('Unhandled error:', error);

  const response: ErrorResponse = {
    error: 'Internal server error',
  };
  return c.json(response, 500);
};
