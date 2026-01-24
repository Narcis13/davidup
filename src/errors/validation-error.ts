import { ZodError } from 'zod';
import { fromError } from 'zod-validation-error';

/**
 * Field-level validation errors.
 * Keys are dot-notation paths (e.g., "output.width").
 * Values are arrays of error messages for that field.
 */
export type FieldErrors = Record<string, string[]>;

/**
 * Formatted validation error with user-friendly messages.
 */
export interface FormattedValidationError {
  /** Human-readable summary of all errors */
  message: string;
  /** Field-level error messages keyed by path */
  fieldErrors: FieldErrors;
}

/**
 * Formats a ZodError into a user-friendly structure.
 * Uses zod-validation-error for the summary message.
 */
export function formatValidationError(
  error: ZodError
): FormattedValidationError {
  // Get user-friendly overall message
  const validationError = fromError(error);

  // Build field-level errors
  const fieldErrors: FieldErrors = {};

  for (const issue of error.issues) {
    const path = issue.path.join('.');
    if (!fieldErrors[path]) {
      fieldErrors[path] = [];
    }
    fieldErrors[path].push(issue.message);
  }

  return {
    message: validationError.message,
    fieldErrors,
  };
}
