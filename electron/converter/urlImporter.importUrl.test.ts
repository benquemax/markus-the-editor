/**
 * Tests for the importUrl function
 *
 * Separated from urlImporter.test.ts because importUrl tests require
 * module-level mocks (vi.mock, vi.stubGlobal) for fetch and Defuddle,
 * which would interfere with the pure-function tests in the main test file.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock global fetch before importing the module under test
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Mock defuddle/node — vi.mock is hoisted to the top of the file by vitest,
// so it intercepts both static and dynamic imports of the module
vi.mock('defuddle/node', () => ({
  Defuddle: vi.fn()
}))

import { importUrl } from './urlImporter'
import type { DefuddleResponse } from 'defuddle/node'
import { Defuddle } from 'defuddle/node'
const mockDefuddle = vi.mocked(Defuddle)

describe('importUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches URL, runs Defuddle, returns markdown with frontmatter', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
      text: () => Promise.resolve('<html><body><h1>Hello</h1><p>World</p></body></html>')
    })
    // When markdown: true is passed, Defuddle puts converted markdown
    // into the content field (overwriting the original HTML)
    mockDefuddle.mockResolvedValue({
      content: '# Hello\n\nWorld',
      title: 'Hello World',
      author: 'Test Author',
    } as Partial<DefuddleResponse> as DefuddleResponse)

    const result = await importUrl('https://example.com/hello-world')

    expect(mockFetch).toHaveBeenCalledWith('https://example.com/hello-world', expect.any(Object))
    expect(result.markdown).toContain('source: https://example.com/hello-world')
    expect(result.markdown).toContain('# Hello')
    expect(result.title).toBe('Hello World')
    expect(result.slug).toBe('hello-world')
  })

  it('throws on non-OK response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found'
    })

    await expect(importUrl('https://example.com/missing'))
      .rejects.toThrow('404')
  })

  it('throws on non-HTML response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/pdf' },
      text: () => Promise.resolve('')
    })

    await expect(importUrl('https://example.com/file.pdf'))
      .rejects.toThrow()
  })

  it('uses slugified title when URL has no slug', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
      text: () => Promise.resolve('<html><body>content</body></html>')
    })
    mockDefuddle.mockResolvedValue({
      content: 'Content',
      title: 'My Great Page',
    } as Partial<DefuddleResponse> as DefuddleResponse)

    const result = await importUrl('https://example.com/')
    expect(result.slug).toBe('my-great-page')
  })

  it('falls back to "Untitled" when Defuddle returns empty title', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
      text: () => Promise.resolve('<html><body>content</body></html>')
    })
    mockDefuddle.mockResolvedValue({
      content: 'Some content',
      title: '',
    } as Partial<DefuddleResponse> as DefuddleResponse)

    const result = await importUrl('https://example.com/some-page')

    expect(result.title).toBe('Untitled')
    // Empty title becomes undefined, so frontmatter should omit the title field
    expect(result.markdown).not.toMatch(/^title:/m)
  })

  it('handles empty content from Defuddle without crashing', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
      text: () => Promise.resolve('<html><body></body></html>')
    })
    mockDefuddle.mockResolvedValue({
      content: '',
      title: 'Empty Page',
    } as Partial<DefuddleResponse> as DefuddleResponse)

    const result = await importUrl('https://example.com/empty')

    // Should still have valid frontmatter even with no content
    expect(result.markdown).toContain('---')
    expect(result.markdown).toContain('source: https://example.com/empty')
  })

  it('includes date_imported field in frontmatter', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
      text: () => Promise.resolve('<html><body><p>Test</p></body></html>')
    })
    mockDefuddle.mockResolvedValue({
      content: 'Test',
      title: 'Test Page',
    } as Partial<DefuddleResponse> as DefuddleResponse)

    const result = await importUrl('https://example.com/test')

    // date_imported should be an ISO date (YYYY-MM-DD format)
    expect(result.markdown).toMatch(/date_imported: \d{4}-\d{2}-\d{2}/)
  })

  it('rejects non-HTTP(S) URLs', async () => {
    await expect(importUrl('ftp://example.com/file'))
      .rejects.toThrow('Only HTTP and HTTPS URLs are supported')

    await expect(importUrl('file:///etc/passwd'))
      .rejects.toThrow('Only HTTP and HTTPS URLs are supported')

    // fetch should never be called for rejected protocols
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
