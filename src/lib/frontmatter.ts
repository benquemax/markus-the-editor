/**
 * Frontmatter (YAML Metadata) Utilities
 *
 * Handles extraction and injection of YAML frontmatter in markdown files.
 * Follows the same extract/inject pattern used by comments.ts and imageBlock.ts:
 * strip before ProseMirror parsing, store as React state, re-inject on serialize.
 *
 * Frontmatter is the YAML block delimited by `---` at the very start of a file,
 * commonly used by static site generators (Hugo, Jekyll, Astro, etc.) and MDX.
 */

import yaml from 'js-yaml'

// JSON_SCHEMA avoids js-yaml's default behavior of auto-converting
// date-like strings ("2024-01-15") into Date objects. Frontmatter
// values should be preserved as the user typed them.
const YAML_OPTIONS = { schema: yaml.JSON_SCHEMA, lineWidth: -1 }

// ============================================================================
// Types
// ============================================================================

export interface FrontmatterField {
  key: string
  value: string
}

export interface FrontmatterData {
  fields: FrontmatterField[]
  /** Raw YAML string (without delimiters) preserved for round-trip fidelity */
  rawYaml: string
}

// ============================================================================
// YAML ↔ Fields Conversion
// ============================================================================

/**
 * Converts a raw YAML string into an ordered array of key-value fields.
 * Non-scalar values (arrays, objects) are stored as their YAML string
 * representation so the UI can display them in a single text input.
 */
export function yamlToFields(yamlStr: string): FrontmatterField[] {
  let parsed: unknown
  try {
    parsed = yaml.load(yamlStr, YAML_OPTIONS)
  } catch {
    // If YAML is malformed, treat the entire block as a single raw field
    return [{ key: '', value: yamlStr.trim() }]
  }

  if (parsed === null || parsed === undefined || typeof parsed !== 'object' || Array.isArray(parsed)) {
    // Non-object top-level (e.g. bare scalar or array) — store as raw
    return [{ key: '', value: yamlStr.trim() }]
  }

  const obj = parsed as Record<string, unknown>
  return Object.entries(obj).map(([key, val]) => ({
    key,
    value: scalarToString(val)
  }))
}

/**
 * Converts an array of key-value fields back into a YAML string.
 * Empty keys are skipped. The result does NOT include `---` delimiters.
 */
export function fieldsToYaml(fields: FrontmatterField[]): string {
  const validFields = fields.filter(f => f.key.trim() !== '')
  if (validFields.length === 0) return ''

  // Build an ordered object. We use yaml.dump which preserves insertion order.
  const obj: Record<string, unknown> = {}
  for (const field of validFields) {
    obj[field.key] = stringToScalar(field.value)
  }

  // yaml.dump adds a trailing newline; trim it for clean delimiters
  return yaml.dump(obj, YAML_OPTIONS).trimEnd()
}

/**
 * Converts any YAML value to a display string for the UI.
 * Scalars become their string representation; complex values become YAML.
 */
function scalarToString(val: unknown): string {
  if (val === null || val === undefined) return ''
  if (typeof val === 'string') return val
  if (typeof val === 'number' || typeof val === 'boolean') return String(val)
  // Arrays, objects → dump as YAML for lossless editing
  return yaml.dump(val, YAML_OPTIONS).trimEnd()
}

/**
 * Attempts to parse a string value back to a YAML scalar.
 * This lets users type "true", "42", or YAML arrays/objects in the value field
 * and have them serialized with the correct YAML type.
 */
function stringToScalar(str: string): unknown {
  if (str === '') return ''
  try {
    const parsed = yaml.load(str, YAML_OPTIONS)
    return parsed
  } catch {
    return str
  }
}

// ============================================================================
// Extract / Inject
// ============================================================================

// Matches YAML frontmatter at the very start of the string.
// Group 1 captures the YAML content between the `---` delimiters.
const FRONTMATTER_REGEX = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

/**
 * Extracts YAML frontmatter from the start of a markdown string.
 *
 * Returns the cleaned markdown (everything after the closing `---`)
 * and the parsed frontmatter data. If no frontmatter is found, returns
 * the original markdown unchanged and null frontmatter.
 */
export function extractFrontmatter(markdown: string): {
  cleaned: string
  frontmatter: FrontmatterData | null
} {
  const match = markdown.match(FRONTMATTER_REGEX)

  if (!match) {
    return { cleaned: markdown, frontmatter: null }
  }

  const rawYaml = match[1]
  const cleaned = markdown.slice(match[0].length)
  const fields = yamlToFields(rawYaml)

  return {
    cleaned,
    frontmatter: { fields, rawYaml }
  }
}

/**
 * Injects frontmatter fields at the top of a markdown string.
 *
 * If frontmatter is null or has no valid fields, returns markdown unchanged.
 * This is the inverse of extractFrontmatter.
 */
export function injectFrontmatter(
  markdown: string,
  frontmatter: FrontmatterData | null
): string {
  if (!frontmatter) return markdown

  const yamlContent = fieldsToYaml(frontmatter.fields)
  if (!yamlContent) return markdown

  return `---\n${yamlContent}\n---\n${markdown}`
}
