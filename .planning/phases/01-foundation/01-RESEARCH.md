# Phase 1: Foundation - Research

**Researched:** 2026-01-25
**Domain:** JSON schema validation for video rendering specifications
**Confidence:** HIGH

## Summary

Phase 1 focuses on JSON schema validation for video specifications with configurable output parameters. The primary challenge is validating user-submitted JSON specs with clear, actionable error messages while maintaining type safety across the TypeScript codebase.

The standard approach in the TypeScript ecosystem is to use **Zod** for schema definition and validation. Zod is TypeScript-first, meaning you define the schema once and get both runtime validation and static TypeScript types automatically. This eliminates the common pitfall of maintaining separate type definitions and validation logic that can drift apart.

For user-friendly error messages suitable for API responses, the **zod-validation-error** library wraps Zod errors into readable messages. The project's existing stack research recommends Fastify with built-in AJV validation, but **fastify-type-provider-zod** provides seamless Zod integration with Fastify routes.

**Primary recommendation:** Use Zod 4 for schema definition with zod-validation-error for human-readable API error responses. Set up the video spec schema with explicit constraints (dimensions, fps, duration) and custom error messages per field.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | ^3.24 or ^4.0 | Schema definition and runtime validation | TypeScript-first, infers types from schemas, 31k GitHub stars, dominant in ecosystem |
| zod-validation-error | ^4.0 | Human-readable error messages | Official solution for user-friendly Zod errors, preserves details |
| fastify-type-provider-zod | ^5.0 | Fastify-Zod integration | Type-safe route handlers, automatic JSON Schema conversion for OpenAPI |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @sinclair/typebox | ^0.34 | Alternative JSON Schema builder | If OpenAPI spec generation becomes priority |
| ajv-errors | ^3.0 | Custom AJV error messages | Only if using raw AJV instead of Zod |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Zod | TypeBox | TypeBox generates standard JSON Schema (better for OpenAPI), but Zod has simpler API and larger community |
| Zod | Yup | Yup is older, less TypeScript-focused, Zod has better ergonomics |
| zod-validation-error | z.flattenError() | Built-in but less configurable, zod-validation-error provides production-ready formatting |

**Installation:**
```bash
npm install zod@^3.24 zod-validation-error@^4 fastify-type-provider-zod@^5
```

Note: As of 2026-01-25, Zod 4 is stable. For fastify-type-provider-zod compatibility:
- v4.x works with Zod 3
- v5.x works with Zod 4

## Architecture Patterns

### Recommended Project Structure
```
src/
├── schemas/           # Zod schema definitions
│   ├── video-spec.ts  # Main video specification schema
│   ├── output.ts      # Output configuration schema
│   └── index.ts       # Re-exports all schemas
├── validators/        # Validation functions that use schemas
│   └── spec-validator.ts
├── types/             # TypeScript types (inferred from Zod schemas)
│   └── index.ts
├── errors/            # Error formatting and handling
│   └── validation-error.ts
└── config/            # App configuration constants
    └── limits.ts      # Video spec limits (dimensions, fps, duration)
```

### Pattern 1: Single Source of Truth Schema
**What:** Define Zod schema, infer TypeScript type from it
**When to use:** Always - prevents type/validation drift
**Example:**
```typescript
// Source: https://zod.dev/basics
import { z } from 'zod';

// Define schema with constraints
export const OutputConfigSchema = z.object({
  width: z.number()
    .int({ message: 'Width must be a whole number' })
    .min(1, 'Width must be at least 1 pixel')
    .max(1920, 'Width cannot exceed 1920 pixels'),
  height: z.number()
    .int({ message: 'Height must be a whole number' })
    .min(1, 'Height must be at least 1 pixel')
    .max(1920, 'Height cannot exceed 1920 pixels'),
  fps: z.number()
    .int({ message: 'FPS must be a whole number' })
    .min(1, 'FPS must be at least 1')
    .max(60, 'FPS cannot exceed 60')
    .default(30),
  duration: z.number()
    .positive('Duration must be positive')
    .max(300, 'Duration cannot exceed 300 seconds'),
});

// Infer TypeScript type - NEVER define this separately
export type OutputConfig = z.infer<typeof OutputConfigSchema>;
```

### Pattern 2: Centralized Limits Configuration
**What:** Define all limits in one place, reference in schemas
**When to use:** For maintainability when limits might change
**Example:**
```typescript
// src/config/limits.ts
export const VIDEO_LIMITS = {
  maxWidth: 1920,
  maxHeight: 1920,
  maxFps: 60,
  minFps: 1,
  defaultFps: 30,
  maxDuration: 300, // seconds
} as const;

// src/schemas/output.ts
import { z } from 'zod';
import { VIDEO_LIMITS } from '../config/limits';

export const OutputConfigSchema = z.object({
  width: z.number().int().min(1).max(VIDEO_LIMITS.maxWidth),
  height: z.number().int().min(1).max(VIDEO_LIMITS.maxHeight),
  fps: z.number().int().min(VIDEO_LIMITS.minFps).max(VIDEO_LIMITS.maxFps).default(VIDEO_LIMITS.defaultFps),
  duration: z.number().positive().max(VIDEO_LIMITS.maxDuration),
});
```

### Pattern 3: User-Friendly Error Formatting
**What:** Transform Zod errors into API-appropriate responses
**When to use:** All API validation error responses
**Example:**
```typescript
// Source: https://github.com/causaly/zod-validation-error
import { fromError } from 'zod-validation-error';
import { z } from 'zod';

export function validateVideoSpec(input: unknown) {
  const result = VideoSpecSchema.safeParse(input);

  if (!result.success) {
    const validationError = fromError(result.error);
    return {
      success: false,
      error: {
        message: validationError.toString(),
        // Include field-level errors for clients
        fieldErrors: z.flattenError(result.error).fieldErrors,
      },
    };
  }

  return { success: true, data: result.data };
}
```

### Pattern 4: Fastify Integration with Type Provider
**What:** Use Zod schemas directly in Fastify routes with full type safety
**When to use:** All API routes that accept JSON input
**Example:**
```typescript
// Source: https://github.com/turkerdev/fastify-type-provider-zod
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  ZodTypeProvider
} from 'fastify-type-provider-zod';
import { z } from 'zod';
import { VideoSpecSchema } from './schemas/video-spec';

const app = Fastify();
app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

app.withTypeProvider<ZodTypeProvider>().post('/render', {
  schema: {
    body: VideoSpecSchema,
    response: {
      200: z.object({ jobId: z.string() }),
      400: z.object({ message: z.string(), fieldErrors: z.record(z.array(z.string())) }),
    },
  },
}, async (request, reply) => {
  // request.body is fully typed as VideoSpec
  const spec = request.body;
  // ...
});
```

### Anti-Patterns to Avoid
- **Separate types and schemas:** Never define TypeScript interfaces separate from Zod schemas. Use `z.infer<>` to derive types.
- **Raw error messages to users:** Always use zod-validation-error or z.flattenError() to format errors. Raw ZodError is developer-focused, not user-friendly.
- **Magic numbers in schemas:** Don't hardcode limits like `.max(1920)` everywhere. Use centralized config.
- **Throwing from validators:** In Fastify context, validators should return error objects, not throw. Use safeParse().
- **Catching all errors as validation errors:** Distinguish between validation errors (400) and system errors (500).

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON validation | Custom if/else checks | Zod schemas | Edge cases (NaN, undefined vs null, type coercion), error accumulation, nested validation |
| Error message formatting | String concatenation | zod-validation-error | Handles nested paths, multiple errors, consistent formatting, i18n support |
| TypeScript type generation | Manual interface definitions | z.infer<typeof Schema> | Prevents drift, single source of truth |
| Enum validation | switch statements | z.enum() | Type inference, exhaustiveness checking, error messages |
| Default values | `value ?? default` | z.default() | Consistent behavior, documented in schema |
| Number constraints | Manual range checks | z.number().min().max() | Clear error messages, composable, type-safe |

**Key insight:** JSON validation has many edge cases (type coercion, null vs undefined, nested objects, arrays). Hand-rolled validation inevitably misses cases and produces inconsistent error messages.

## Common Pitfalls

### Pitfall 1: Types and Validation Drift
**What goes wrong:** Separate TypeScript interfaces and validation logic drift apart over time, causing runtime errors when types say one thing but validation allows another.
**Why it happens:** Developers update the interface but forget to update validation, or vice versa.
**How to avoid:** Always use `z.infer<typeof Schema>` to derive types. Never manually define interfaces for validated data.
**Warning signs:** TypeScript types defined in one file, validation in another; manual type casting after validation.

### Pitfall 2: Throwing Errors in Async Hooks
**What goes wrong:** Fastify async hooks crash the application when validators throw instead of returning error objects.
**Why it happens:** Common pattern of `throw new Error()` in validators doesn't work with Fastify's async architecture.
**How to avoid:** Always use `safeParse()` and return `{ error }` objects. Configure custom error handlers.
**Warning signs:** Unhandled promise rejections in logs; app crashes on validation failures.

### Pitfall 3: Raw Zod Errors in API Responses
**What goes wrong:** Users receive developer-focused error messages with internal paths like `data.output.width`.
**Why it happens:** Passing ZodError.message directly to response without formatting.
**How to avoid:** Use zod-validation-error's `fromError()` for user-facing messages, `z.flattenError()` for structured field errors.
**Warning signs:** Error messages containing `.` paths or `"required_error"` strings.

### Pitfall 4: Missing Custom Error Messages
**What goes wrong:** Users see generic "Expected number, received string" instead of helpful "Width must be a number".
**Why it happens:** Not providing custom messages in schema definitions.
**How to avoid:** Add custom messages to every constraint: `z.number({ message: 'Width must be a number' }).max(1920, 'Width cannot exceed 1920')`.
**Warning signs:** Generic Zod error types in responses.

### Pitfall 5: Validation-Only Without Type Narrowing
**What goes wrong:** TypeScript still treats data as `unknown` or `any` after validation because validation function doesn't use type guards properly.
**Why it happens:** Using validation without leveraging Zod's type inference.
**How to avoid:** Use `safeParse()` return type which includes typed `data` property when `success: true`.
**Warning signs:** Type assertions (`as VideoSpec`) after validation calls.

### Pitfall 6: Forgetting Integer Constraint for Dimensions
**What goes wrong:** Users submit `width: 1080.5` which passes number validation but causes issues downstream in rendering.
**Why it happens:** Using `z.number()` alone which allows floats.
**How to avoid:** Use `z.number().int()` for dimensions and fps.
**Warning signs:** Float values in pixel dimensions; fractional fps values.

## Code Examples

Verified patterns from official sources:

### Complete Video Spec Schema
```typescript
// Source: Zod documentation patterns applied to video spec domain
import { z } from 'zod';
import { VIDEO_LIMITS } from '../config/limits';

// Output configuration with all constraints
export const OutputConfigSchema = z.object({
  width: z.number({
    required_error: 'Width is required',
    invalid_type_error: 'Width must be a number',
  })
    .int('Width must be a whole number')
    .min(1, 'Width must be at least 1 pixel')
    .max(VIDEO_LIMITS.maxWidth, `Width cannot exceed ${VIDEO_LIMITS.maxWidth} pixels`),

  height: z.number({
    required_error: 'Height is required',
    invalid_type_error: 'Height must be a number',
  })
    .int('Height must be a whole number')
    .min(1, 'Height must be at least 1 pixel')
    .max(VIDEO_LIMITS.maxHeight, `Height cannot exceed ${VIDEO_LIMITS.maxHeight} pixels`),

  fps: z.number({
    invalid_type_error: 'FPS must be a number',
  })
    .int('FPS must be a whole number')
    .min(VIDEO_LIMITS.minFps, `FPS must be at least ${VIDEO_LIMITS.minFps}`)
    .max(VIDEO_LIMITS.maxFps, `FPS cannot exceed ${VIDEO_LIMITS.maxFps}`)
    .default(VIDEO_LIMITS.defaultFps),

  duration: z.number({
    required_error: 'Duration is required',
    invalid_type_error: 'Duration must be a number',
  })
    .positive('Duration must be positive')
    .max(VIDEO_LIMITS.maxDuration, `Duration cannot exceed ${VIDEO_LIMITS.maxDuration} seconds`),
});

export type OutputConfig = z.infer<typeof OutputConfigSchema>;

// Full video specification (stub for phase 1, expanded in later phases)
export const VideoSpecSchema = z.object({
  output: OutputConfigSchema,
  // scenes will be added in Phase 2
});

export type VideoSpec = z.infer<typeof VideoSpecSchema>;
```

### Validation Function with Error Formatting
```typescript
// Source: zod-validation-error + Zod patterns
import { z } from 'zod';
import { fromError } from 'zod-validation-error';
import { VideoSpecSchema, VideoSpec } from '../schemas/video-spec';

export interface ValidationSuccess {
  success: true;
  data: VideoSpec;
}

export interface ValidationFailure {
  success: false;
  error: {
    message: string;
    fieldErrors: Record<string, string[]>;
  };
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

export function validateVideoSpec(input: unknown): ValidationResult {
  const result = VideoSpecSchema.safeParse(input);

  if (result.success) {
    return { success: true, data: result.data };
  }

  const validationError = fromError(result.error);
  const flattened = z.flattenError(result.error);

  return {
    success: false,
    error: {
      message: validationError.toString(),
      fieldErrors: flattened.fieldErrors as Record<string, string[]>,
    },
  };
}
```

### Fastify Error Handler for Validation Errors
```typescript
// Source: Fastify docs + fastify-type-provider-zod patterns
import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { fromError } from 'zod-validation-error';
import { z } from 'zod';

export function validationErrorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
) {
  if (hasZodFastifySchemaValidationErrors(error)) {
    const zodError = error.validation as z.ZodError;
    const validationError = fromError(zodError);
    const flattened = z.flattenError(zodError);

    return reply.status(400).send({
      message: validationError.toString(),
      fieldErrors: flattened.fieldErrors,
    });
  }

  // Not a validation error, let default handler deal with it
  throw error;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Joi for validation | Zod | 2020-2022 | TypeScript-first, better DX, type inference |
| Manual TypeScript types + validation | z.infer<> | Zod v1 (2020) | Single source of truth |
| AJV with JSON Schema | Zod or TypeBox | 2021-2023 | Better TypeScript integration |
| Custom error formatting | zod-validation-error | 2022 | Standardized user-friendly messages |
| Zod 3 | Zod 4 | 2025 | Stable release, improved performance |

**Deprecated/outdated:**
- **Joi:** Still maintained but not TypeScript-first. Zod is the standard for new TypeScript projects.
- **io-ts:** Functional programming style, steeper learning curve. Zod has simpler API.
- **z.formatError():** Deprecated in Zod 4, use z.treeifyError() or z.flattenError() instead.
- **class-validator:** Requires decorators and classes, not compatible with functional patterns.

## Open Questions

Things that couldn't be fully resolved:

1. **Zod 3 vs Zod 4 for this project**
   - What we know: Zod 4 is stable as of late 2025, fastify-type-provider-zod v5+ supports it
   - What's unclear: Whether all ecosystem packages fully support Zod 4 yet
   - Recommendation: Start with Zod 3.24 (latest v3), upgrade to v4 after confirming all deps support it

2. **Schema organization for future phases**
   - What we know: Phase 1 only needs output config; Phases 2-4 add scenes, elements, animations
   - What's unclear: Best way to structure schema files for incremental expansion
   - Recommendation: Create extensible schema structure now; VideoSpecSchema wraps OutputConfigSchema, ready for scenes array

## Sources

### Primary (HIGH confidence)
- [Zod Documentation](https://zod.dev/) - API reference, error customization, error formatting
- [Fastify Validation and Serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/) - AJV configuration, custom validators
- [fastify-type-provider-zod GitHub](https://github.com/turkerdev/fastify-type-provider-zod) - Integration patterns, error handling

### Secondary (MEDIUM confidence)
- [zod-validation-error GitHub](https://github.com/causaly/zod-validation-error) - Error formatting library, configuration options
- [TypeBox vs Zod comparison](https://betterstack.com/community/guides/scaling-nodejs/typebox-vs-zod/) - Stack selection rationale

### Tertiary (LOW confidence)
- WebSearch results for "JSON schema validation pitfalls" - Common patterns, may vary by project

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Zod is definitively the TypeScript ecosystem standard, well documented
- Architecture: HIGH - Patterns follow official documentation and common usage
- Pitfalls: MEDIUM - Based on documentation + community patterns, some project-specific validation needed

**Research date:** 2026-01-25
**Valid until:** 2026-02-25 (Zod ecosystem is stable, 30 days validity)
