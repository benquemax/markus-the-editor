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
})
