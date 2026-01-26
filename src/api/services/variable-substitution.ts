/**
 * Variable substitution service for template customization.
 *
 * Provides utilities to extract and substitute {{variable}} placeholders
 * in VideoSpec objects.
 */
import type { VideoSpec } from '../../types/index.js';

/**
 * Extract all unique variable names from a VideoSpec.
 *
 * @param spec - The VideoSpec to search for variables
 * @returns Sorted array of unique variable names
 */
export function extractVariables(spec: VideoSpec): string[] {
  const json = JSON.stringify(spec);
  const regex = /\{\{(\w+)\}\}/g;
  const variables = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = regex.exec(json)) !== null) {
    variables.add(match[1]);
  }

  return Array.from(variables).sort();
}

/**
 * Substitute variables in a VideoSpec with provided values.
 *
 * @param spec - The VideoSpec containing {{variables}} to replace
 * @param values - Map of variable names to replacement values
 * @returns New VideoSpec with variables substituted
 */
export function substituteVariables(
  spec: VideoSpec,
  values: Record<string, string>
): VideoSpec {
  let json = JSON.stringify(spec);

  for (const [key, value] of Object.entries(values)) {
    // Escape special JSON characters in the value
    const escapedValue = value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');

    // Replace all occurrences of {{key}} with the escaped value
    const pattern = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    json = json.replace(pattern, escapedValue);
  }

  return JSON.parse(json) as VideoSpec;
}
