# Phase 6: AI Integration - Research

**Researched:** 2026-01-26
**Domain:** AI template generation, variable substitution, built-in templates
**Confidence:** HIGH

## Summary

This phase adds AI-powered template generation from natural language descriptions and built-in starter templates. The AI service receives a user's description (e.g., "create a TikTok ad for a coffee shop") along with platform/style preferences, and returns a valid VideoSpec JSON with {{variables}} for user substitution.

Research confirms OpenRouter as the recommended AI provider, offering access to 300+ models through a unified API with OpenAI-compatible request format, structured output support, and response healing plugins. The implementation follows a multi-layer validation approach: AI generates JSON -> JSON.parse -> Zod validation -> auto-repair common issues -> re-prompt if invalid.

Variable substitution uses Mustache-style `{{variableName}}` syntax, processed before validation. Built-in templates are stored as static JSON files, loaded at startup, and served via a templates API.

**Primary recommendation:** Use OpenRouter with structured output mode (when available) or JSON mode fallback, Zod for validation with existing VideoSpecSchema, a TemplateService for variable substitution, and a TemplateStore for built-in templates.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| openrouter (fetch) | API | AI model access | 300+ models, OpenAI-compatible, structured outputs |
| zod | ^3.25.x | JSON validation | Already using, type-safe, detailed errors |
| zod-to-json-schema | ^3.x | Schema conversion | Convert Zod to JSON Schema for AI |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| async-retry | ^1.3.x | API retries | Handle transient API failures |
| crypto (built-in) | Node.js | Template IDs | randomUUID for template identifiers |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| OpenRouter | Direct OpenAI/Anthropic | Lock-in to single provider; OpenRouter provides flexibility |
| OpenRouter | Vercel AI SDK | Extra dependency; OpenRouter API is simple enough for direct use |
| Mustache {{}} | Handlebars | Handlebars is heavier; simple substitution doesn't need logic |
| Static JSON templates | Database | Overhead for MVP; static files are simple and fast |

**No additional dependencies needed** - the project already has async-retry, zod, and fetch is built-in.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── api/
│   ├── routes/
│   │   ├── templates.ts     # GET /templates, GET /templates/:id, POST /templates/render
│   │   └── generate.ts      # POST /generate
│   ├── services/
│   │   ├── ai-client.ts     # OpenRouter API client
│   │   ├── template-generator.ts  # AI-driven spec generation
│   │   ├── template-store.ts      # Built-in template storage
│   │   └── variable-substitution.ts  # {{variable}} processing
│   └── types.ts             # Extend with template types
├── templates/               # Built-in template JSON files
│   ├── tiktok-promo.json
│   ├── youtube-intro.json
│   ├── instagram-story.json
│   └── index.ts             # Template registry
└── schemas/
    └── template.ts          # TemplateSpec, GenerateRequest schemas
```

### Pattern 1: AI Template Generation with Multi-Layer Validation
**What:** Generate VideoSpec from natural language with validation and repair
**When to use:** POST /generate endpoint
**Example:**
```typescript
// Source: OpenRouter docs + Zod validation patterns
import { z } from 'zod';
import retry from 'async-retry';
import { VideoSpecSchema } from '../schemas/video-spec.js';

interface GenerateRequest {
  description: string;
  platform: 'tiktok' | 'youtube' | 'instagram';
  style: 'energetic' | 'professional' | 'playful';
}

interface GenerateResult {
  spec: VideoSpec;
  variables: string[];  // List of {{variable}} names
}

// Platform presets for dimensions
const PLATFORM_PRESETS = {
  tiktok: { width: 1080, height: 1920, fps: 30 },      // 9:16
  youtube: { width: 1920, height: 1080, fps: 30 },    // 16:9
  instagram: { width: 1080, height: 1080, fps: 30 },  // 1:1
} as const;

async function generateTemplate(request: GenerateRequest): Promise<GenerateResult> {
  const systemPrompt = buildSystemPrompt(request);
  const userPrompt = request.description;

  // Layer 1: Call AI with retry
  const rawResponse = await retry(
    async () => {
      const response = await callOpenRouter({
        model: 'anthropic/claude-sonnet-4',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
      });
      return response.choices[0].message.content;
    },
    { retries: 2, factor: 2, minTimeout: 1000 }
  );

  // Layer 2: Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawResponse);
  } catch {
    // Attempt JSON repair for common issues
    const repaired = repairJson(rawResponse);
    parsed = JSON.parse(repaired);
  }

  // Layer 3: Zod validation
  const validationResult = VideoSpecSchema.safeParse(parsed);
  if (!validationResult.success) {
    // Layer 4: Auto-repair common issues
    const repaired = autoRepairSpec(parsed, validationResult.error);
    const retryResult = VideoSpecSchema.safeParse(repaired);

    if (!retryResult.success) {
      // Layer 5: Re-prompt with error context
      return await regenerateWithContext(request, rawResponse, retryResult.error);
    }

    return {
      spec: retryResult.data,
      variables: extractVariables(retryResult.data),
    };
  }

  return {
    spec: validationResult.data,
    variables: extractVariables(validationResult.data),
  };
}
```

### Pattern 2: OpenRouter API Client
**What:** HTTP client for OpenRouter API calls
**When to use:** All AI generation requests
**Example:**
```typescript
// Source: OpenRouter API documentation
interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenRouterRequest {
  model: string;
  messages: OpenRouterMessage[];
  response_format?: { type: 'json_object' };
  temperature?: number;
  max_tokens?: number;
}

interface OpenRouterResponse {
  id: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

async function callOpenRouter(request: OpenRouterRequest): Promise<OpenRouterResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY environment variable not set');
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.APP_URL ?? 'https://gamemotion.dev',
      'X-Title': 'GameMotion',
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(60_000), // 60s timeout
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
  }

  return response.json();
}
```

### Pattern 3: System Prompt for Template Generation
**What:** Construct effective system prompt for AI
**When to use:** Template generation requests
**Example:**
```typescript
function buildSystemPrompt(request: GenerateRequest): string {
  const preset = PLATFORM_PRESETS[request.platform];

  return `You are a video template generator for GameMotion, a JSON-to-video rendering engine.

Generate a valid VideoSpec JSON that matches this schema:
- output: { width: ${preset.width}, height: ${preset.height}, fps: ${preset.fps}, duration: <calculated> }
- scenes: Array of scenes with elements (text, image, shape)
- Each scene needs: duration, background color, elements array
- Elements can have animations with enter/exit presets

STYLE GUIDELINES for "${request.style}":
${getStyleGuidelines(request.style)}

IMPORTANT RULES:
1. Use {{variableName}} for user-customizable content (e.g., {{headline}}, {{productName}})
2. All text elements should use {{variables}} for customizable content
3. Include at least one image element with {{imageUrl}} or similar variable
4. Duration should be appropriate for ${request.platform} (TikTok: 15-60s, YouTube: 30-120s, Instagram: 15-30s)
5. Return ONLY valid JSON, no markdown or explanation

PLATFORM: ${request.platform}
DIMENSIONS: ${preset.width}x${preset.height}
STYLE: ${request.style}`;
}

function getStyleGuidelines(style: string): string {
  const guidelines = {
    energetic: `- Fast-paced animations (0.3-0.5s durations)
- Bold colors, high contrast
- Use scale and bounce presets for enter animations
- Quick scene transitions (0.3s fade)`,
    professional: `- Smooth, subtle animations (0.5-0.8s durations)
- Clean, minimal color palette
- Use fade and slide presets
- Longer scene transitions (0.5-0.8s fade)`,
    playful: `- Bouncy, fun animations
- Bright, vibrant colors
- Mix of scale, bounce, and slide presets
- Creative transitions between scenes`,
  };
  return guidelines[style] ?? guidelines.professional;
}
```

### Pattern 4: Variable Substitution
**What:** Replace {{variables}} with actual values
**When to use:** Before rendering a template with user data
**Example:**
```typescript
// Variable extraction
function extractVariables(spec: VideoSpec): string[] {
  const variables = new Set<string>();
  const regex = /\{\{(\w+)\}\}/g;

  // Recursively find all {{variables}} in the spec
  const findVariables = (obj: unknown): void => {
    if (typeof obj === 'string') {
      let match;
      while ((match = regex.exec(obj)) !== null) {
        variables.add(match[1]);
      }
    } else if (Array.isArray(obj)) {
      obj.forEach(findVariables);
    } else if (obj && typeof obj === 'object') {
      Object.values(obj).forEach(findVariables);
    }
  };

  findVariables(spec);
  return Array.from(variables);
}

// Variable substitution
function substituteVariables(
  spec: VideoSpec,
  values: Record<string, string>
): VideoSpec {
  const json = JSON.stringify(spec);

  const substituted = json.replace(
    /\{\{(\w+)\}\}/g,
    (match, varName) => {
      if (varName in values) {
        // Escape for JSON string context
        return values[varName].replace(/"/g, '\\"');
      }
      return match; // Keep unsubstituted if no value provided
    }
  );

  return JSON.parse(substituted);
}
```

### Pattern 5: Built-in Template Store
**What:** Store and serve built-in starter templates
**When to use:** GET /templates, GET /templates/:id endpoints
**Example:**
```typescript
interface BuiltInTemplate {
  id: string;
  name: string;
  description: string;
  platform: 'tiktok' | 'youtube' | 'instagram' | 'universal';
  style: string;
  variables: Array<{
    name: string;
    description: string;
    type: 'text' | 'url' | 'color';
    default?: string;
  }>;
  spec: VideoSpec;
}

class TemplateStore {
  private templates = new Map<string, BuiltInTemplate>();

  constructor() {
    this.loadBuiltInTemplates();
  }

  private loadBuiltInTemplates(): void {
    // Load from static files or inline definitions
    const templates: BuiltInTemplate[] = [
      {
        id: 'tiktok-product-showcase',
        name: 'TikTok Product Showcase',
        description: 'Fast-paced product reveal with text overlays',
        platform: 'tiktok',
        style: 'energetic',
        variables: [
          { name: 'productName', description: 'Product name', type: 'text' },
          { name: 'tagline', description: 'Catchy tagline', type: 'text' },
          { name: 'productImage', description: 'Product image URL', type: 'url' },
          { name: 'price', description: 'Product price', type: 'text' },
        ],
        spec: { /* ... */ },
      },
      // ... more templates
    ];

    for (const template of templates) {
      this.templates.set(template.id, template);
    }
  }

  list(): BuiltInTemplate[] {
    return Array.from(this.templates.values());
  }

  get(id: string): BuiltInTemplate | undefined {
    return this.templates.get(id);
  }
}
```

### Pattern 6: Auto-Repair Common AI JSON Issues
**What:** Fix common issues in AI-generated JSON
**When to use:** When Zod validation fails on AI output
**Example:**
```typescript
function autoRepairSpec(spec: unknown, error: z.ZodError): unknown {
  if (!spec || typeof spec !== 'object') return spec;

  const repaired = JSON.parse(JSON.stringify(spec));

  for (const issue of error.issues) {
    const path = issue.path;

    // Common repairs based on error type
    switch (issue.code) {
      case 'invalid_type':
        // Type coercion
        if (issue.expected === 'number' && issue.received === 'string') {
          setPath(repaired, path, parseFloat(getPath(repaired, path)));
        }
        break;

      case 'too_small':
        // Clamp to minimum
        if (typeof issue.minimum === 'number') {
          setPath(repaired, path, Math.max(issue.minimum, getPath(repaired, path)));
        }
        break;

      case 'too_big':
        // Clamp to maximum
        if (typeof issue.maximum === 'number') {
          setPath(repaired, path, Math.min(issue.maximum, getPath(repaired, path)));
        }
        break;

      case 'invalid_enum_value':
        // Map common variations
        const value = getPath(repaired, path);
        const mapped = mapEnumValue(value, issue.options as string[]);
        if (mapped) setPath(repaired, path, mapped);
        break;
    }
  }

  return repaired;
}

function mapEnumValue(value: string, options: string[]): string | undefined {
  // Common mappings for AI variations
  const normalizedValue = value.toLowerCase().trim();

  for (const option of options) {
    if (option.toLowerCase() === normalizedValue) return option;
    // Handle common variations
    if (normalizedValue.includes(option.toLowerCase())) return option;
  }

  // Return first option as fallback for single-option fields
  return options.length === 1 ? options[0] : undefined;
}
```

### Anti-Patterns to Avoid
- **Trusting AI output blindly:** Always validate with Zod before using
- **Single-shot generation:** Implement retry with error context for better results
- **Hardcoded model:** Use config/env for model selection to allow easy switching
- **No rate limiting on AI calls:** OpenRouter has rate limits; handle 429 gracefully
- **Exposing raw AI errors:** Sanitize error messages before returning to users
- **Prompt injection via user description:** Sanitize user input, use structural separation

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON Schema for AI | Manual schema string | zod-to-json-schema | Consistent with existing Zod schemas |
| HTTP retry | setTimeout loops | async-retry | Already using, proven patterns |
| JSON parsing | Basic try/catch | JSON repair + validation | AI output often has subtle issues |
| Variable regex | Custom parser | Standard Mustache regex | Well-known, tested pattern |

## Common Pitfalls

### Pitfall 1: AI Hallucinating Invalid Properties
**What goes wrong:** AI invents properties not in schema (e.g., "animation: 'custom'")
**Why it happens:** Models trained on various JSON schemas, not specifically VideoSpec
**How to avoid:** Use response_format: { type: 'json_object' }, provide clear schema in prompt
**Warning signs:** Zod errors about unknown keys

### Pitfall 2: Inconsistent Variable Naming
**What goes wrong:** AI uses different variable patterns ({{name}}, ${name}, {name})
**Why it happens:** Models trained on multiple template syntaxes
**How to avoid:** Explicitly state {{variableName}} format in prompt, show examples
**Warning signs:** Variables not extracted correctly

### Pitfall 3: Token Limits for Complex Templates
**What goes wrong:** Response truncated mid-JSON for complex templates
**Why it happens:** Output exceeds max_tokens
**How to avoid:** Set appropriate max_tokens (4096+), simplify prompt for complex specs
**Warning signs:** JSON parse errors, incomplete output

### Pitfall 4: Model Unavailability
**What goes wrong:** Preferred model returns 503/429
**Why it happens:** Provider rate limits or outages
**How to avoid:** Configure fallback models, use OpenRouter's auto-routing
**Warning signs:** Intermittent failures during high load

### Pitfall 5: Prompt Injection Attacks
**What goes wrong:** Malicious users inject instructions via description field
**Why it happens:** User input concatenated directly into prompt
**How to avoid:** Sanitize input (remove instruction markers), structural separation in prompt, validate output content
**Warning signs:** Generated specs contain unexpected content or instructions

### Pitfall 6: Variable Substitution Breaking JSON
**What goes wrong:** Substituted values break JSON structure
**Why it happens:** Values containing quotes or special characters not escaped
**How to avoid:** Escape substituted values for JSON context, validate after substitution
**Warning signs:** JSON parse errors after substitution

## API Design

### POST /generate - Generate Template from Description

**Request:**
```typescript
interface GenerateRequest {
  description: string;      // Natural language description
  platform: 'tiktok' | 'youtube' | 'instagram';
  style: 'energetic' | 'professional' | 'playful';
}
```

**Response (201):**
```typescript
interface GenerateResponse {
  spec: VideoSpec;          // Generated template with {{variables}}
  variables: Array<{
    name: string;
    description?: string;   // AI-suggested description
    type: 'text' | 'url';  // Inferred type
  }>;
}
```

### GET /templates - List Built-in Templates

**Response (200):**
```typescript
interface TemplatesListResponse {
  templates: Array<{
    id: string;
    name: string;
    description: string;
    platform: string;
    style: string;
    variables: Array<{ name: string; description: string; type: string }>;
    thumbnail_url?: string;
  }>;
}
```

### GET /templates/:id - Get Template Details

**Response (200):**
```typescript
interface TemplateResponse {
  id: string;
  name: string;
  description: string;
  platform: string;
  style: string;
  variables: Array<{ name: string; description: string; type: string; default?: string }>;
  spec: VideoSpec;          // Full spec with {{variables}}
}
```

### POST /templates/:id/render - Render Template with Variables

**Request:**
```typescript
interface RenderTemplateRequest {
  variables: Record<string, string>;  // Variable values
  webhook_url?: string;
  sync?: boolean;
}
```

**Response (202):** Same as POST /render

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single AI provider | Multi-provider via OpenRouter | 2024+ | Flexibility, cost optimization |
| Manual JSON mode | Structured outputs | 2024 | More reliable JSON generation |
| Simple retry | Response healing + repair | 2025 | Better success rate |
| Raw prompts | Few-shot examples | Best practice | More consistent output |

**Current best practices:**
- Use response_format: { type: 'json_object' } for JSON output
- Include 1-2 examples in system prompt for complex schemas
- Implement multi-layer validation (parse -> validate -> repair -> re-prompt)
- Use OpenRouter's response healing plugin when available
- Keep prompts focused; split complex generation into multiple calls if needed

## Open Questions

1. **Which model for template generation?**
   - What we know: Claude Sonnet, GPT-4o, and Gemini all work; cost/quality tradeoffs
   - What's unclear: Best balance of quality, speed, and cost for this use case
   - Recommendation: Start with Claude Sonnet 4 (good JSON reliability), benchmark alternatives

2. **Template versioning?**
   - What we know: Templates may need updates; users may have saved old versions
   - What's unclear: How to handle template updates without breaking saved configs
   - Recommendation: Add version field to templates, maintain backward compatibility

3. **User-created templates?**
   - What we know: Built-in templates for MVP; users may want to save generated templates
   - What's unclear: Should this be v1 or later?
   - Recommendation: Out of scope for v1; can be added as database-backed feature later

4. **Caching generated templates?**
   - What we know: Same description/platform/style could return consistent results
   - What's unclear: Cache invalidation strategy, storage limits
   - Recommendation: No caching for MVP; each generation is unique

5. **Starter template content?**
   - What we know: Need templates for common use cases
   - What's unclear: Exact templates to include
   - Recommendation: Start with 5-7 templates covering common platforms/styles

## Recommended Built-in Templates

Initial set of 7 templates covering key use cases:

| ID | Name | Platform | Style | Key Elements |
|----|------|----------|-------|--------------|
| tiktok-product-showcase | TikTok Product Showcase | TikTok | Energetic | Product image, price, CTA |
| youtube-intro | YouTube Intro | YouTube | Professional | Channel name, logo, tagline |
| instagram-story-promo | Instagram Story Promo | Instagram | Playful | Background image, overlay text, swipe CTA |
| social-announcement | Social Announcement | Universal | Professional | Headline, date, details |
| countdown-timer | Countdown Timer | Universal | Energetic | Event name, countdown animation |
| quote-card | Animated Quote Card | Universal | Professional | Quote text, attribution |
| before-after | Before/After Reveal | Universal | Professional | Two images with reveal transition |

## Environment Variables

```bash
# Required
OPENROUTER_API_KEY=sk-or-v1-xxxxx

# Optional
OPENROUTER_MODEL=anthropic/claude-sonnet-4  # Default model
OPENROUTER_FALLBACK_MODEL=openai/gpt-4o     # Fallback if primary fails
OPENROUTER_MAX_TOKENS=4096                   # Max output tokens
OPENROUTER_TIMEOUT=60000                     # Timeout in ms
```

## Sources

### Primary (HIGH confidence)
- [OpenRouter Documentation](https://openrouter.ai/docs) - API format, models, structured outputs
- [Zod Documentation](https://zod.dev) - Validation patterns, error handling
- Existing project research (SUMMARY.md) - AI integration patterns

### Secondary (MEDIUM confidence)
- [OpenAI Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs) - JSON mode patterns
- [Anthropic Claude API](https://docs.anthropic.com/en/api) - Claude-specific patterns
- Existing Phase 5 implementation - API patterns, route structure

### Tertiary (LOW confidence)
- Various LLM prompt engineering guides - Prompt construction
- Template syntax comparisons - Variable substitution patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - OpenRouter well-documented, existing Zod integration
- Architecture: HIGH - Follows existing API patterns from Phase 5
- AI Generation: MEDIUM - Model selection and prompt tuning may need iteration
- Pitfalls: HIGH - Well-documented AI/JSON issues with known solutions

**Research date:** 2026-01-26
**Valid until:** ~30 days (AI landscape evolves quickly; verify model recommendations)
