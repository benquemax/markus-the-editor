/**
 * Tests for CodeEditor markdown validation functionality.
 * Tests the validateMarkdown function used for detecting invalid markdown
 * and preventing sync to WYSIWYG editor when errors exist.
 */
import { describe, it, expect } from 'vitest'
import { markdownParser } from '../editor/markdown'

/**
 * Validate markdown content using the parser.
 * This mirrors the validation logic in CodeEditor.tsx.
 */
function validateMarkdown(content: string): { valid: boolean; errors: Array<{ line: number; message: string }> } {
  try {
    const doc = markdownParser.parse(content)
    if (!doc) {
      return { valid: false, errors: [{ line: 1, message: 'Failed to parse markdown' }] }
    }
    return { valid: true, errors: [] }
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    return { valid: false, errors: [{ line: 1, message: errorMessage }] }
  }
}

describe('validateMarkdown', () => {
  describe('valid markdown', () => {
    it('should validate empty content', () => {
      const result = validateMarkdown('')
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should validate simple text', () => {
      const result = validateMarkdown('Hello, world!')
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should validate headings', () => {
      const result = validateMarkdown('# Heading 1\n## Heading 2\n### Heading 3')
      expect(result.valid).toBe(true)
    })

    it('should validate bold and italic text', () => {
      const result = validateMarkdown('**bold** and *italic* and ***both***')
      expect(result.valid).toBe(true)
    })

    it('should validate links', () => {
      const result = validateMarkdown('[link text](https://example.com)')
      expect(result.valid).toBe(true)
    })

    it('should validate images', () => {
      const result = validateMarkdown('![alt text](image.png)')
      expect(result.valid).toBe(true)
    })

    it('should validate code blocks', () => {
      const result = validateMarkdown('```javascript\nconst x = 1;\n```')
      expect(result.valid).toBe(true)
    })

    it('should validate inline code', () => {
      const result = validateMarkdown('Use `code` here')
      expect(result.valid).toBe(true)
    })

    it('should validate bullet lists', () => {
      const result = validateMarkdown('- item 1\n- item 2\n- item 3')
      expect(result.valid).toBe(true)
    })

    it('should validate numbered lists', () => {
      const result = validateMarkdown('1. first\n2. second\n3. third')
      expect(result.valid).toBe(true)
    })

    it('should validate blockquotes', () => {
      const result = validateMarkdown('> This is a quote\n> with multiple lines')
      expect(result.valid).toBe(true)
    })

    it('should validate horizontal rules', () => {
      const result = validateMarkdown('---\n***\n___')
      expect(result.valid).toBe(true)
    })

    it('should validate tables', () => {
      const table = `| Header 1 | Header 2 |
| -------- | -------- |
| Cell 1   | Cell 2   |`
      const result = validateMarkdown(table)
      expect(result.valid).toBe(true)
    })

    it('should validate HTML img tags', () => {
      const result = validateMarkdown('<img src="image.png" alt="test" align="center" width="50%" />')
      expect(result.valid).toBe(true)
    })

    it('should validate complex mixed content', () => {
      const content = `# Title

This is a paragraph with **bold** and *italic* text.

## Lists

- Item 1
- Item 2
  - Nested item

## Code

\`\`\`typescript
const x: number = 42;
\`\`\`

## Quote

> Important note

---

| Column A | Column B |
| -------- | -------- |
| Value 1  | Value 2  |

![Image](example.png)
`
      const result = validateMarkdown(content)
      expect(result.valid).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('should handle unclosed emphasis gracefully', () => {
      // Unclosed emphasis is valid markdown - it just renders literally
      const result = validateMarkdown('This is **unclosed bold')
      expect(result.valid).toBe(true)
    })

    it('should handle unclosed code block', () => {
      // Unclosed code block - markdown-it handles this gracefully
      const result = validateMarkdown('```\ncode without closing')
      expect(result.valid).toBe(true)
    })

    it('should handle malformed table', () => {
      // Malformed table - treated as plain text
      const result = validateMarkdown('| no | header |')
      expect(result.valid).toBe(true)
    })

    it('should handle only whitespace', () => {
      const result = validateMarkdown('   \n\t\n  ')
      expect(result.valid).toBe(true)
    })

    it('should handle special characters', () => {
      const result = validateMarkdown('Special chars: & < > " \' © ™ €')
      expect(result.valid).toBe(true)
    })

    it('should handle very long lines', () => {
      const longLine = 'a'.repeat(10000)
      const result = validateMarkdown(longLine)
      expect(result.valid).toBe(true)
    })

    it('should handle deeply nested lists', () => {
      const nested = `- Level 1
  - Level 2
    - Level 3
      - Level 4
        - Level 5`
      const result = validateMarkdown(nested)
      expect(result.valid).toBe(true)
    })
  })
})
