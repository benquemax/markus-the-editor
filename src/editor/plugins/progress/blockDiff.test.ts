/**
 * Block Diff Algorithm Tests
 *
 * Tests the core block-level diffing and word-level diffing logic
 * used by Show Edits mode.
 */

import { describe, it, expect } from 'vitest'
import { schema } from '../../schema'
import { markdownParser } from '../../markdown'
import { computeBlockDiff, computeWordDiff } from './blockDiff'

/** Helper: parse markdown string into a ProseMirror doc. */
function parse(md: string) {
  return markdownParser.parse(md)!
}

describe('computeBlockDiff', () => {
  it('returns all unchanged for identical documents', () => {
    const doc = parse('# Hello\n\nWorld\n\nFoo bar')
    const alignments = computeBlockDiff(doc, doc)

    expect(alignments).toHaveLength(3)
    for (const a of alignments) {
      expect(a.status).toBe('unchanged')
    }
  })

  it('detects an added block at the end', () => {
    const committed = parse('# Hello\n\nWorld')
    const current = parse('# Hello\n\nWorld\n\nNew paragraph')
    const alignments = computeBlockDiff(current, committed)

    expect(alignments).toHaveLength(3)
    expect(alignments[0].status).toBe('unchanged')
    expect(alignments[1].status).toBe('unchanged')
    expect(alignments[2].status).toBe('added')
    expect(alignments[2].currentIndex).toBe(2)
    expect(alignments[2].committedIndex).toBeNull()
  })

  it('detects a deleted block', () => {
    const committed = parse('# Hello\n\nMiddle\n\nWorld')
    const current = parse('# Hello\n\nWorld')
    const alignments = computeBlockDiff(current, committed)

    // Should have: unchanged(Hello), deleted(Middle), unchanged(World)
    const deleted = alignments.filter(a => a.status === 'deleted')
    expect(deleted).toHaveLength(1)
    expect(deleted[0].committedIndex).toBe(1)
    expect(deleted[0].currentIndex).toBeNull()

    const unchanged = alignments.filter(a => a.status === 'unchanged')
    expect(unchanged).toHaveLength(2)
  })

  it('detects a modified block', () => {
    const committed = parse('The quick brown fox jumps over the lazy dog')
    const current = parse('The quick red fox jumps over the lazy dog')
    const alignments = computeBlockDiff(current, committed)

    expect(alignments).toHaveLength(1)
    expect(alignments[0].status).toBe('modified')
    expect(alignments[0].wordDiff).toBeDefined()
    expect(alignments[0].wordDiff!.length).toBeGreaterThan(0)
  })

  it('treats completely rewritten text as delete + add (below similarity threshold)', () => {
    const committed = parse('This is the original paragraph about cats')
    const current = parse('A completely different text about dogs and weather')
    const alignments = computeBlockDiff(current, committed)

    // When similarity is below 0.3, the algorithm correctly treats them as
    // separate delete + add rather than a modified pair
    const statuses = alignments.map(a => a.status)
    expect(statuses).toContain('deleted')
    expect(statuses).toContain('added')
  })

  it('handles empty committed doc (new file — all blocks added)', () => {
    const committed = schema.nodes.doc.create(null, [])
    const current = parse('# Hello\n\nWorld')
    const alignments = computeBlockDiff(current, committed)

    expect(alignments.every(a => a.status === 'added')).toBe(true)
  })

  it('handles empty current doc (all blocks deleted)', () => {
    const committed = parse('# Hello\n\nWorld')
    const current = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create()
    ])
    const alignments = computeBlockDiff(current, committed)

    const deleted = alignments.filter(a => a.status === 'deleted')
    expect(deleted.length).toBeGreaterThan(0)
  })

  it('preserves block order in alignments', () => {
    const committed = parse('AAA\n\nBBB\n\nCCC')
    const current = parse('AAA\n\nBBB modified\n\nCCC\n\nDDD')
    const alignments = computeBlockDiff(current, committed)

    // First should be unchanged (AAA)
    expect(alignments[0].status).toBe('unchanged')
    expect(alignments[0].currentIndex).toBe(0)

    // Last should be added (DDD)
    const last = alignments[alignments.length - 1]
    expect(last.status).toBe('added')
  })
})

describe('computeWordDiff', () => {
  it('returns all keep for identical text', () => {
    const segments = computeWordDiff('hello world', 'hello world')
    const nonKeep = segments.filter(s => s.type !== 'keep')
    expect(nonKeep).toHaveLength(0)
  })

  it('detects a replaced word', () => {
    const segments = computeWordDiff('the quick brown fox', 'the quick red fox')

    const removed = segments.filter(s => s.type === 'removed')
    const added = segments.filter(s => s.type === 'added')

    expect(removed.length).toBeGreaterThan(0)
    expect(added.length).toBeGreaterThan(0)

    // The removed text should contain "brown"
    const removedText = removed.map(s => s.text).join('')
    expect(removedText).toContain('brown')

    // The added text should contain "red"
    const addedText = added.map(s => s.text).join('')
    expect(addedText).toContain('red')
  })

  it('detects added words', () => {
    const segments = computeWordDiff('hello world', 'hello brave new world')

    const added = segments.filter(s => s.type === 'added')
    expect(added.length).toBeGreaterThan(0)
    const addedText = added.map(s => s.text).join('')
    expect(addedText).toContain('brave')
    expect(addedText).toContain('new')
  })

  it('detects removed words', () => {
    const segments = computeWordDiff('hello brave new world', 'hello world')

    const removed = segments.filter(s => s.type === 'removed')
    expect(removed.length).toBeGreaterThan(0)
    const removedText = removed.map(s => s.text).join('')
    expect(removedText).toContain('brave')
    expect(removedText).toContain('new')
  })

  it('handles completely different text', () => {
    const segments = computeWordDiff('aaa bbb ccc', 'xxx yyy zzz')
    const removed = segments.filter(s => s.type === 'removed')
    const added = segments.filter(s => s.type === 'added')

    expect(removed.length).toBeGreaterThan(0)
    expect(added.length).toBeGreaterThan(0)
  })

  it('handles empty old text', () => {
    const segments = computeWordDiff('', 'hello world')
    expect(segments).toHaveLength(1)
    expect(segments[0].type).toBe('added')
    expect(segments[0].text).toBe('hello world')
  })

  it('handles empty new text', () => {
    const segments = computeWordDiff('hello world', '')
    expect(segments).toHaveLength(1)
    expect(segments[0].type).toBe('removed')
    expect(segments[0].text).toBe('hello world')
  })
})
