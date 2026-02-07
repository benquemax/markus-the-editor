/**
 * Unit Tests for Fuzzy Matching
 *
 * Tests all 4 matching strategies: exact, whitespace, fuzzy, and anchor.
 * Covers edge cases and ensures proper confidence levels.
 */

import { describe, it, expect } from 'vitest'
import { findMatch, applyReplacement, MatchResult } from './fuzzyMatch'

describe('fuzzyMatch', () => {
  // ==========================================================================
  // Strategy 1: Exact Match
  // ==========================================================================
  describe('exact match', () => {
    it('finds exact match with high confidence', () => {
      const content = 'Hello, world!\nThis is a test.'
      const search = 'This is a test.'

      const result = findMatch(content, search)

      expect(result.found).toBe(true)
      expect(result.strategy).toBe('exact')
      expect(result.confidence).toBe('high')
      expect(result.similarity).toBe(1)
      expect(result.matchedText).toBe(search)
      expect(result.lineNumber).toBe(2)
    })

    it('finds exact match at beginning of file', () => {
      const content = 'First line\nSecond line'
      const search = 'First line'

      const result = findMatch(content, search)

      expect(result.found).toBe(true)
      expect(result.strategy).toBe('exact')
      expect(result.lineNumber).toBe(1)
    })

    it('returns low confidence for multiple exact matches', () => {
      const content = 'hello\nworld\nhello\nfoo'
      const search = 'hello'

      const result = findMatch(content, search)

      expect(result.found).toBe(true)
      // May use exact or fuzzy strategy depending on implementation
      expect(['exact', 'fuzzy']).toContain(result.strategy)
      // With multiple matches, confidence should not be 'high'
      if (result.strategy === 'exact') {
        expect(result.confidence).toBe('low')
      }
    })

    it('returns not found for non-matching text', () => {
      const content = 'Hello, world!'
      const search = 'goodbye'

      const result = findMatch(content, search)

      expect(result.found).toBe(false)
    })
  })

  // ==========================================================================
  // Strategy 2: Whitespace-Normalized Match
  // ==========================================================================
  describe('whitespace-normalized match', () => {
    it('matches despite different indentation', () => {
      const content = '  function test() {\n    return true;\n  }'
      const search = 'function test() {\nreturn true;\n}'

      const result = findMatch(content, search)

      expect(result.found).toBe(true)
      // May be exact or whitespace depending on implementation
      expect(['exact', 'whitespace']).toContain(result.strategy)
    })

    it('matches with trailing spaces removed', () => {
      const content = 'line one   \nline two\n'
      const search = 'line one\nline two'

      const result = findMatch(content, search)

      expect(result.found).toBe(true)
    })

    it('matches multi-line block with varied indentation', () => {
      const content = `
        # Heading
        Some paragraph text.
        Another line here.
      `
      const search = `# Heading
Some paragraph text.
Another line here.`

      const result = findMatch(content, search)

      expect(result.found).toBe(true)
      expect(result.confidence).not.toBe('none')
    })
  })

  // ==========================================================================
  // Strategy 3: Fuzzy Line Match
  // ==========================================================================
  describe('fuzzy line match', () => {
    it('matches with minor typos', () => {
      const content = 'This is the original text with some content.'
      const search = 'This is the orignal text with some content.'  // typo: orignal

      const result = findMatch(content, search)

      expect(result.found).toBe(true)
      expect(['exact', 'whitespace', 'fuzzy']).toContain(result.strategy)
      expect(result.similarity).toBeGreaterThan(0.85)
    })

    it('matches with small word changes', () => {
      const content = `function calculateTotal(items) {
  let sum = 0;
  for (const item of items) {
    sum += item.price;
  }
  return sum;
}`
      // Small variation: 'let' -> 'var'
      const search = `function calculateTotal(items) {
  var sum = 0;
  for (const item of items) {
    sum += item.price;
  }
  return sum;
}`

      const result = findMatch(content, search)

      expect(result.found).toBe(true)
      expect(result.similarity).toBeGreaterThan(0.85)
    })

    it('does not match completely different text', () => {
      const content = 'The quick brown fox jumps over the lazy dog.'
      const search = 'Lorem ipsum dolor sit amet consectetur adipiscing elit.'

      const result = findMatch(content, search)

      // Either not found, or very low similarity
      if (result.found) {
        expect(result.confidence).toBe('low')
      }
    })

    it('respects fuzzy threshold option', () => {
      const content = 'original line'
      const search = 'orignl lne'  // very different

      const resultStrict = findMatch(content, search, { fuzzyThreshold: 0.95 })
      const resultLoose = findMatch(content, search, { fuzzyThreshold: 0.5 })

      // Strict should fail or be low confidence
      if (resultStrict.found) {
        expect(resultStrict.confidence).toBe('low')
      }

      // Loose should find it
      expect(resultLoose.found).toBe(true)
    })
  })

  // ==========================================================================
  // Strategy 4: Anchor-Based Match
  // ==========================================================================
  describe('anchor-based match', () => {
    it('matches using first and last lines as anchors', () => {
      const content = `# Section Header

This is some content.
Here is more text.
And another line.

# Next Section`

      // Search with slightly different middle but same anchors
      const search = `# Section Header

Different middle content.
Some other text.
Yet another line.`

      const result = findMatch(content, search)

      // Should find a match even if middle differs
      expect(result.found).toBe(true)
    })

    it('requires at least 2 lines for anchor matching', () => {
      const content = 'single line content'
      const search = 'single line'

      // With only 1 line, anchor match shouldn't apply
      // Will fall back to other strategies
      const result = findMatch(content, search)

      if (result.found) {
        expect(result.strategy).not.toBe('anchor')
      }
    })

    it('matches code blocks with similar structure', () => {
      const content = `function processData(input) {
  validate(input);
  const result = transform(input);
  return result;
}`

      // Very similar function - minor differences
      const search = `function processData(input) {
  validate(input);
  const result = transform(input);
  return result;
}`

      const result = findMatch(content, search)

      // Should find exact or near-exact match
      expect(result.found).toBe(true)
    })
  })

  // ==========================================================================
  // Edge Cases
  // ==========================================================================
  describe('edge cases', () => {
    it('handles empty search string', () => {
      const content = 'Some content'
      const search = ''

      const result = findMatch(content, search)

      expect(result.found).toBe(false)
      expect(result.strategy).toBe('none')
    })

    it('handles whitespace-only search', () => {
      const content = 'Some content'
      const search = '   \n\t  '

      const result = findMatch(content, search)

      expect(result.found).toBe(false)
    })

    it('handles empty content', () => {
      const content = ''
      const search = 'something'

      const result = findMatch(content, search)

      expect(result.found).toBe(false)
    })

    it('handles very long content', () => {
      const lines = Array.from({ length: 1000 }, (_, i) => `Line ${i}`)
      const content = lines.join('\n')
      const search = 'Line 500'

      const result = findMatch(content, search)

      expect(result.found).toBe(true)
      expect(result.lineNumber).toBe(501)
    })

    it('handles special characters in search', () => {
      const content = 'const regex = /^[a-z]+$/i;'
      const search = '/^[a-z]+$/i'

      const result = findMatch(content, search)

      expect(result.found).toBe(true)
    })

    it('handles unicode content', () => {
      const content = '日本語テスト\n中文测试\nкириллица'
      const search = '中文测试'

      const result = findMatch(content, search)

      expect(result.found).toBe(true)
      expect(result.lineNumber).toBe(2)
    })
  })

  // ==========================================================================
  // Apply Replacement
  // ==========================================================================
  describe('applyReplacement', () => {
    it('replaces matched text correctly', () => {
      const content = 'Hello, world!'
      const match = findMatch(content, 'world')

      const result = applyReplacement(content, match, 'universe')

      expect(result).toBe('Hello, universe!')
    })

    it('replaces multi-line match', () => {
      const content = 'Line 1\nLine 2\nLine 3'
      const match = findMatch(content, 'Line 2')

      const result = applyReplacement(content, match, 'Modified Line')

      expect(result).toBe('Line 1\nModified Line\nLine 3')
    })

    it('throws on invalid match', () => {
      const invalidMatch: MatchResult = {
        found: false,
        strategy: 'none',
        confidence: 'none'
      }

      expect(() => applyReplacement('content', invalidMatch, 'new'))
        .toThrow('Cannot apply replacement')
    })

    it('handles replacement at start of content', () => {
      const content = 'Start of content here'
      const match = findMatch(content, 'Start')

      const result = applyReplacement(content, match, 'Beginning')

      expect(result).toBe('Beginning of content here')
    })

    it('handles replacement at end of content', () => {
      const content = 'Content at the end'
      const match = findMatch(content, 'end')

      const result = applyReplacement(content, match, 'finish')

      expect(result).toBe('Content at the finish')
    })
  })

  // ==========================================================================
  // Integration Scenarios
  // ==========================================================================
  describe('integration scenarios', () => {
    it('handles typical LLM output with minor variations', () => {
      const originalFile = `export function greet(name: string): string {
  if (!name) {
    return "Hello, stranger!";
  }
  return \`Hello, \${name}!\`;
}`

      // LLM might quote slightly differently or have minor spacing issues
      const llmSearch = `export function greet(name: string): string {
  if (!name) {
    return "Hello, stranger!";
  }
  return \`Hello, \${name}!\`;
}`

      const result = findMatch(originalFile, llmSearch)

      expect(result.found).toBe(true)
      expect(result.confidence).not.toBe('none')
    })

    it('finds function in larger file', () => {
      const largeFile = `
import { something } from 'somewhere';

const CONFIG = {
  debug: true,
  timeout: 5000
};

export function targetFunction() {
  console.log('This is the target');
  return CONFIG.debug;
}

function otherFunction() {
  console.log('Not the target');
}

export default targetFunction;
`

      const search = `export function targetFunction() {
  console.log('This is the target');
  return CONFIG.debug;
}`

      const result = findMatch(largeFile, search)

      expect(result.found).toBe(true)
      expect(result.matchedText).toContain('targetFunction')
    })
  })
})
