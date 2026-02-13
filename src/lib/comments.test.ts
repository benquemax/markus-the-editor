import { describe, it, expect } from 'vitest'
import {
  extractComments,
  injectComments,
  serializeCommentEntries,
  generateCommentId,
  CommentEntry,
  CommentInjection
} from './comments'

describe('generateCommentId', () => {
  it('returns unique IDs', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 100; i++) {
      ids.add(generateCommentId())
    }
    expect(ids.size).toBe(100)
  })

  it('IDs start with "c"', () => {
    expect(generateCommentId()).toMatch(/^c/)
  })
})

describe('extractComments', () => {
  it('extracts a single comment', () => {
    const md = 'Hello <!-- COMMENT: [{ "alice": "Nice!" }] -->world<!-- /COMMENT --> end'
    const { cleaned, comments } = extractComments(md)

    expect(cleaned).toBe('Hello world end')
    expect(comments).toHaveLength(1)
    expect(comments[0].thread.entries).toEqual([{ author: 'alice', text: 'Nice!' }])
    expect(comments[0].startOffset).toBe(6) // "Hello " = 6 chars
    expect(comments[0].endOffset).toBe(11) // "Hello world" = 11 chars
  })

  it('extracts multiple comments', () => {
    const md = '<!-- COMMENT: [{ "a": "first" }] -->one<!-- /COMMENT --> middle <!-- COMMENT: [{ "b": "second" }] -->two<!-- /COMMENT --> end'
    const { cleaned, comments } = extractComments(md)

    expect(cleaned).toBe('one middle two end')
    expect(comments).toHaveLength(2)
    expect(comments[0].thread.entries[0]).toEqual({ author: 'a', text: 'first' })
    expect(comments[0].startOffset).toBe(0)
    expect(comments[0].endOffset).toBe(3)
    expect(comments[1].thread.entries[0]).toEqual({ author: 'b', text: 'second' })
    expect(comments[1].startOffset).toBe(11) // "one middle " = 11
    expect(comments[1].endOffset).toBe(14) // "one middle two" = 14
  })

  it('handles threaded comments with multiple entries', () => {
    const md = '<!-- COMMENT: [{ "alice": "What about this?" }, { "bob": "I disagree!" }] -->text<!-- /COMMENT -->'
    const { cleaned, comments } = extractComments(md)

    expect(cleaned).toBe('text')
    expect(comments[0].thread.entries).toEqual([
      { author: 'alice', text: 'What about this?' },
      { author: 'bob', text: 'I disagree!' }
    ])
  })

  it('returns unmodified text when no comments', () => {
    const md = 'No comments here'
    const { cleaned, comments } = extractComments(md)

    expect(cleaned).toBe('No comments here')
    expect(comments).toHaveLength(0)
  })

  it('handles invalid JSON gracefully', () => {
    const md = '<!-- COMMENT: [not-valid-json] -->text<!-- /COMMENT -->'
    const { cleaned, comments } = extractComments(md)

    expect(cleaned).toBe('text')
    expect(comments[0].thread.entries).toEqual([])
  })

  it('ignores malformed markers without brackets', () => {
    const md = '<!-- COMMENT: not-json -->text<!-- /COMMENT -->'
    const { cleaned, comments } = extractComments(md)

    // Regex requires [...] so this doesn't match — text passes through unchanged
    expect(cleaned).toBe(md)
    expect(comments).toHaveLength(0)
  })

  it('handles multiline highlighted text', () => {
    const md = '<!-- COMMENT: [{ "a": "note" }] -->line one\nline two<!-- /COMMENT -->'
    const { cleaned, comments } = extractComments(md)

    expect(cleaned).toBe('line one\nline two')
    expect(comments[0].startOffset).toBe(0)
    expect(comments[0].endOffset).toBe(17)
  })

  it('preserves text around comments', () => {
    const md = 'before <!-- COMMENT: [{ "a": "x" }] -->middle<!-- /COMMENT --> after'
    const { cleaned, comments } = extractComments(md)

    expect(cleaned).toBe('before middle after')
    expect(comments).toHaveLength(1)
    expect(cleaned.slice(comments[0].startOffset, comments[0].endOffset)).toBe('middle')
  })
})

describe('serializeCommentEntries', () => {
  it('serializes entries to JSON', () => {
    const entries: CommentEntry[] = [
      { author: 'alice', text: 'Hello' },
      { author: 'bob', text: 'World' }
    ]
    const json = serializeCommentEntries(entries)
    expect(JSON.parse(json)).toEqual([
      { alice: 'Hello' },
      { bob: 'World' }
    ])
  })

  it('serializes empty entries', () => {
    expect(serializeCommentEntries([])).toBe('[]')
  })
})

describe('injectComments', () => {
  it('injects a single comment', () => {
    const md = 'Hello world end'
    const injections: CommentInjection[] = [{
      thread: { id: 'test', entries: [{ author: 'alice', text: 'Nice!' }] },
      startOffset: 6,
      endOffset: 11
    }]

    const result = injectComments(md, injections)
    expect(result).toBe('Hello <!-- COMMENT: [{"alice":"Nice!"}] -->world<!-- /COMMENT --> end')
  })

  it('injects multiple comments', () => {
    const md = 'one middle two end'
    const injections: CommentInjection[] = [
      {
        thread: { id: 't1', entries: [{ author: 'a', text: 'first' }] },
        startOffset: 0,
        endOffset: 3
      },
      {
        thread: { id: 't2', entries: [{ author: 'b', text: 'second' }] },
        startOffset: 11,
        endOffset: 14
      }
    ]

    const result = injectComments(md, injections)
    expect(result).toBe('<!-- COMMENT: [{"a":"first"}] -->one<!-- /COMMENT --> middle <!-- COMMENT: [{"b":"second"}] -->two<!-- /COMMENT --> end')
  })

  it('returns unmodified text with empty injections', () => {
    expect(injectComments('Hello', [])).toBe('Hello')
  })

  it('handles unsorted injections', () => {
    const md = 'abc def'
    const injections: CommentInjection[] = [
      { thread: { id: 't2', entries: [{ author: 'b', text: 'y' }] }, startOffset: 4, endOffset: 7 },
      { thread: { id: 't1', entries: [{ author: 'a', text: 'x' }] }, startOffset: 0, endOffset: 3 }
    ]

    const result = injectComments(md, injections)
    expect(result).toBe('<!-- COMMENT: [{"a":"x"}] -->abc<!-- /COMMENT --> <!-- COMMENT: [{"b":"y"}] -->def<!-- /COMMENT -->')
  })
})

describe('round-trip: extract → inject', () => {
  it('round-trips a single comment', () => {
    const original = 'Hello <!-- COMMENT: [{"alice":"Nice!"}] -->world<!-- /COMMENT --> end'
    const { cleaned, comments } = extractComments(original)

    const injections: CommentInjection[] = comments.map(c => ({
      thread: c.thread,
      startOffset: c.startOffset,
      endOffset: c.endOffset
    }))

    const result = injectComments(cleaned, injections)
    expect(result).toBe(original)
  })

  it('round-trips multiple comments', () => {
    const original = '<!-- COMMENT: [{"a":"first"}] -->one<!-- /COMMENT --> middle <!-- COMMENT: [{"b":"second"}] -->two<!-- /COMMENT --> end'
    const { cleaned, comments } = extractComments(original)

    const injections: CommentInjection[] = comments.map(c => ({
      thread: c.thread,
      startOffset: c.startOffset,
      endOffset: c.endOffset
    }))

    const result = injectComments(cleaned, injections)
    expect(result).toBe(original)
  })

  it('round-trips threaded comments', () => {
    const original = 'text <!-- COMMENT: [{"alice":"Why?"},{"bob":"Because!"}] -->here<!-- /COMMENT --> done'
    const { cleaned, comments } = extractComments(original)

    const injections: CommentInjection[] = comments.map(c => ({
      thread: c.thread,
      startOffset: c.startOffset,
      endOffset: c.endOffset
    }))

    const result = injectComments(cleaned, injections)
    expect(result).toBe(original)
  })
})
