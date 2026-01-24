import { VideoSpecSchema } from '../schemas/video-spec.js';
import {
  formatValidationError,
  type FormattedValidationError,
} from '../errors/validation-error.js';
import type { VideoSpec } from '../types/index.js';

/** Result type for successful validation */
export interface ValidationSuccess {
  success: true;
  data: VideoSpec;
}

/** Result type for failed validation */
export interface ValidationFailure {
  success: false;
  error: FormattedValidationError;
}

/** Discriminated union for validation results */
export type ValidationResult = ValidationSuccess | ValidationFailure;

/**
 * Validates unknown input against the VideoSpecSchema.
 *
 * @param input - Unknown input to validate
 * @returns Discriminated union with either success+data or success=false+error
 *
 * @example
 * ```typescript
 * const result = validateVideoSpec({ output: { width: 1920, height: 1080, duration: 60 } });
 * if (result.success) {
 *   console.log(result.data.output.fps); // 30 (default)
 * } else {
 *   console.log(result.error.fieldErrors); // { "output.width": [...] }
 * }
 * ```
 */
export function validateVideoSpec(input: unknown): ValidationResult {
  const result = VideoSpecSchema.safeParse(input);

  if (result.success) {
    return {
      success: true,
      data: result.data,
    };
  }

  return {
    success: false,
    error: formatValidationError(result.error),
  };
}
