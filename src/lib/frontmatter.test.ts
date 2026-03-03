/**
 * Frontmatter Utilities Tests
 *
 * Tests the extract/inject roundtrip for YAML frontmatter,
 * field conversion, and edge cases like missing delimiters
 * and Windows line endings.
 */

import { describe, it, expect } from 'vitest'
import {
  extractFrontmatter,
  injectFrontmatter,
  yamlToFields,
  fieldsToYaml,
  FrontmatterData
} from './frontmatter'

// ============================================================================
// extractFrontmatter
// ============================================================================

describe('extractFrontmatter', () => {
  it('extracts simple key-value frontmatter', () => {
    const md = '---\ntitle: Hello World\n---\n# Content'
    const { cleaned, frontmatter } = extractFrontmatter(md)

    expect(cleaned).toBe('# Content')
    expect(frontmatter).not.toBeNull()
    expect(frontmatter!.fields).toEqual([{ key: 'title', value: 'Hello World' }])
  })

  it('extracts multiple fields preserving order', () => {
    const md = '---\ntitle: My Post\ndate: 2024-01-15\ndraft: true\n---\nBody text'
    const { cleaned, frontmatter } = extractFrontmatter(md)

    expect(cleaned).toBe('Body text')
    expect(frontmatter!.fields).toHaveLength(3)
    expect(frontmatter!.fields[0]).toEqual({ key: 'title', value: 'My Post' })
    expect(frontmatter!.fields[1]).toEqual({ key: 'date', value: '2024-01-15' })
    expect(frontmatter!.fields[2]).toEqual({ key: 'draft', value: 'true' })
  })

  it('returns null frontmatter when none present', () => {
    const md = '# Just a heading\n\nSome text'
    const { cleaned, frontmatter } = extractFrontmatter(md)

    expect(cleaned).toBe(md)
    expect(frontmatter).toBeNull()
  })

  it('does not match --- that is not at the start of string', () => {
    const md = 'Some text\n---\ntitle: Not Frontmatter\n---\nMore text'
    const { cleaned, frontmatter } = extractFrontmatter(md)

    expect(cleaned).toBe(md)
    expect(frontmatter).toBeNull()
  })

  it('handles empty field values', () => {
    const md = '---\ntitle:\ndescription:\n---\nContent'
    const { frontmatter } = extractFrontmatter(md)

    expect(frontmatter!.fields).toEqual([
      { key: 'title', value: '' },
      { key: 'description', value: '' }
    ])
  })

  it('handles Windows line endings (CRLF)', () => {
    const md = '---\r\ntitle: Hello\r\n---\r\n# Content'
    const { cleaned, frontmatter } = extractFrontmatter(md)

    expect(cleaned).toBe('# Content')
    expect(frontmatter!.fields).toEqual([{ key: 'title', value: 'Hello' }])
  })

  it('handles nested YAML structures as string values', () => {
    const md = '---\ntitle: Post\ntags:\n  - javascript\n  - typescript\n---\nContent'
    const { frontmatter } = extractFrontmatter(md)

    expect(frontmatter!.fields).toHaveLength(2)
    expect(frontmatter!.fields[0]).toEqual({ key: 'title', value: 'Post' })
    // Arrays get serialized as YAML for lossless round-trip
    expect(frontmatter!.fields[1].key).toBe('tags')
    expect(frontmatter!.fields[1].value).toContain('javascript')
    expect(frontmatter!.fields[1].value).toContain('typescript')
  })

  it('preserves raw YAML for round-trip fidelity', () => {
    const rawYaml = 'title: Hello\ndate: 2024-01-15'
    const md = `---\n${rawYaml}\n---\nContent`
    const { frontmatter } = extractFrontmatter(md)

    expect(frontmatter!.rawYaml).toBe(rawYaml)
  })

  it('does not match a lone --- (horizontal rule)', () => {
    const md = '# Heading\n\n---\n\nMore content'
    const { cleaned, frontmatter } = extractFrontmatter(md)

    expect(cleaned).toBe(md)
    expect(frontmatter).toBeNull()
  })

  it('handles frontmatter with trailing spaces on delimiters', () => {
    const md = '---   \ntitle: Trimmed\n---   \nContent'
    const { cleaned, frontmatter } = extractFrontmatter(md)

    expect(cleaned).toBe('Content')
    expect(frontmatter!.fields).toEqual([{ key: 'title', value: 'Trimmed' }])
  })

  it('handles frontmatter at EOF without trailing newline', () => {
    const md = '---\ntitle: EOF\n---'
    const { cleaned, frontmatter } = extractFrontmatter(md)

    expect(cleaned).toBe('')
    expect(frontmatter!.fields).toEqual([{ key: 'title', value: 'EOF' }])
  })
})

// ============================================================================
// injectFrontmatter
// ============================================================================

describe('injectFrontmatter', () => {
  it('injects frontmatter at the top of markdown', () => {
    const fm: FrontmatterData = {
      fields: [{ key: 'title', value: 'Hello' }],
      rawYaml: 'title: Hello'
    }
    const result = injectFrontmatter('# Content', fm)
    expect(result).toBe('---\ntitle: Hello\n---\n# Content')
  })

  it('returns markdown unchanged when frontmatter is null', () => {
    const result = injectFrontmatter('# Content', null)
    expect(result).toBe('# Content')
  })

  it('returns markdown unchanged when all fields have empty keys', () => {
    const fm: FrontmatterData = {
      fields: [{ key: '', value: 'orphan value' }],
      rawYaml: ''
    }
    const result = injectFrontmatter('# Content', fm)
    expect(result).toBe('# Content')
  })

  it('skips fields with empty keys but keeps valid ones', () => {
    const fm: FrontmatterData = {
      fields: [
        { key: 'title', value: 'Valid' },
        { key: '', value: 'skipped' }
      ],
      rawYaml: ''
    }
    const result = injectFrontmatter('Content', fm)
    expect(result).toContain('title: Valid')
    expect(result).not.toContain('skipped')
  })
})

// ============================================================================
// Round-trip: extract → inject
// ============================================================================

describe('round-trip', () => {
  it('extract then inject reproduces original frontmatter', () => {
    const original = '---\ntitle: Hello World\ndate: 2024-01-15\ndraft: false\n---\n# Content here'
    const { cleaned, frontmatter } = extractFrontmatter(original)
    const result = injectFrontmatter(cleaned, frontmatter)

    expect(result).toBe(original)
  })

  it('round-trips with empty body', () => {
    const original = '---\ntitle: Solo\n---\n'
    const { cleaned, frontmatter } = extractFrontmatter(original)
    const result = injectFrontmatter(cleaned, frontmatter)

    expect(result).toBe(original)
  })
})

// ============================================================================
// yamlToFields / fieldsToYaml
// ============================================================================

describe('yamlToFields', () => {
  it('parses simple key-value pairs', () => {
    const fields = yamlToFields('title: Hello\nauthor: Alice')
    expect(fields).toEqual([
      { key: 'title', value: 'Hello' },
      { key: 'author', value: 'Alice' }
    ])
  })

  it('converts boolean and number values to strings', () => {
    const fields = yamlToFields('draft: true\ncount: 42')
    expect(fields).toEqual([
      { key: 'draft', value: 'true' },
      { key: 'count', value: '42' }
    ])
  })

  it('handles null values as empty strings', () => {
    const fields = yamlToFields('title:')
    expect(fields).toEqual([{ key: 'title', value: '' }])
  })
})

describe('fieldsToYaml', () => {
  it('converts fields back to YAML', () => {
    const yaml = fieldsToYaml([
      { key: 'title', value: 'Hello' },
      { key: 'draft', value: 'true' }
    ])
    expect(yaml).toContain('title: Hello')
    expect(yaml).toContain('draft: true')
  })

  it('returns empty string for no valid fields', () => {
    expect(fieldsToYaml([])).toBe('')
    expect(fieldsToYaml([{ key: '', value: 'no key' }])).toBe('')
  })
})
