/**
 * Tests for URL Importer utilities
 *
 * Covers slug extraction from URLs, title slugification for filenames,
 * and YAML frontmatter generation with source metadata.
 */

import { describe, it, expect } from 'vitest'
import { extractSlug, slugifyTitle, generateFrontmatter } from './urlImporter'

describe('extractSlug', () => {
  it('extracts slug from URL path', () => {
    expect(extractSlug('https://example.com/some-article')).toBe('some-article')
  })

  it('extracts last path segment ignoring trailing slash', () => {
    expect(extractSlug('https://example.com/blog/my-post/')).toBe('my-post')
  })

  it('returns null for index pages', () => {
    expect(extractSlug('https://example.com/')).toBeNull()
    expect(extractSlug('https://example.com')).toBeNull()
  })

  it('strips file extensions from slug', () => {
    expect(extractSlug('https://example.com/page.html')).toBe('page')
  })

  it('strips query params and hash', () => {
    expect(extractSlug('https://example.com/article?ref=twitter#section')).toBe('article')
  })

  it('returns null for empty string', () => {
    expect(extractSlug('')).toBeNull()
  })

  it('returns null for non-URL text', () => {
    expect(extractSlug('not a url at all')).toBeNull()
  })
})

describe('slugifyTitle', () => {
  it('lowercases and replaces spaces with dashes', () => {
    expect(slugifyTitle('My Great Page')).toBe('my-great-page')
  })

  it('strips special characters', () => {
    expect(slugifyTitle('Hello, World! (2026)')).toBe('hello-world-2026')
  })

  it('collapses multiple dashes', () => {
    expect(slugifyTitle('foo   bar')).toBe('foo-bar')
  })

  it('returns empty string for empty input', () => {
    expect(slugifyTitle('')).toBe('')
  })

  it('returns empty string when all characters are special', () => {
    expect(slugifyTitle('!@#$%^&*()')).toBe('')
  })
})

describe('generateFrontmatter', () => {
  it('generates frontmatter with all fields', () => {
    const result = generateFrontmatter({
      source: 'https://example.com/article',
      title: 'My Article',
      author: 'John Doe',
      dateImported: '2026-03-03'
    })
    expect(result).toBe(
      '---\nsource: https://example.com/article\ntitle: My Article\nauthor: John Doe\ndate_imported: 2026-03-03\n---\n\n'
    )
  })

  it('omits empty fields', () => {
    const result = generateFrontmatter({
      source: 'https://example.com',
      title: 'Page',
      dateImported: '2026-03-03'
    })
    expect(result).not.toContain('author')
  })

  it('escapes YAML special characters in title', () => {
    const result = generateFrontmatter({
      source: 'https://example.com',
      title: 'Title: With Colon',
      dateImported: '2026-03-03'
    })
    expect(result).toContain('title: "Title: With Colon"')
  })

  it('escapes author with internal single quote', () => {
    const result = generateFrontmatter({
      source: 'https://example.com',
      author: "O'Brien",
      dateImported: '2026-03-03'
    })
    expect(result).toContain('author: "O\'Brien"')
  })

  it('escapes YAML boolean keyword in title', () => {
    const result = generateFrontmatter({
      source: 'https://example.com',
      title: 'True',
      dateImported: '2026-03-03'
    })
    expect(result).toContain('title: "True"')
  })
})
