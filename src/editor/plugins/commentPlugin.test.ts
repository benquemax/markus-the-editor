/**
 * Comment Plugin Tests
 *
 * Tests the ProseMirror comment plugin state management, the addCommentCommand,
 * and plugin state transitions (addEntry, resolveThread, toggle visibility).
 * Uses real ProseMirror EditorState instances for accurate behavior testing.
 */

import { describe, it, expect, vi } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import { schema } from '../schema'
import {
  createCommentPlugin,
  commentPluginKey,
  addCommentCommand,
  CommentPluginMeta
} from './commentPlugin'

/**
 * Creates an EditorState with the comment plugin and a simple doc.
 * The doc contains a single paragraph with the given text.
 */
function createState(text: string, onStateChange = vi.fn()) {
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, text ? [schema.text(text)] : [])
  ])
  return EditorState.create({
    doc,
    plugins: [createCommentPlugin(onStateChange)]
  })
}

/**
 * Selects a range in the given state (1-based positions inside the paragraph).
 * Position 1 is the start of text inside the paragraph.
 */
function selectRange(state: EditorState, from: number, to: number) {
  return state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, from, to))
  )
}

describe('Comment Plugin', () => {
  describe('initial state', () => {
    it('initializes with empty threads and hidden comments', () => {
      const state = createState('Hello world')
      const pluginState = commentPluginKey.getState(state)

      expect(pluginState).toBeDefined()
      expect(pluginState!.threads.size).toBe(0)
      expect(pluginState!.activeCommentId).toBeNull()
      expect(pluginState!.showComments).toBe(false)
      expect(pluginState!.contextMenu).toBeNull()
    })
  })

  describe('addCommentCommand', () => {
    it('returns false for empty selection', () => {
      const state = createState('Hello world')
      const result = addCommentCommand(state)
      expect(result).toBe(false)
    })

    it('returns true for non-empty selection', () => {
      let state = createState('Hello world')
      // Select "Hello" (positions 1-6 in ProseMirror, which is inside the paragraph)
      state = selectRange(state, 1, 6)
      const result = addCommentCommand(state)
      expect(result).toBe(true)
    })

    it('adds comment mark and creates thread when dispatched', () => {
      const onStateChange = vi.fn()
      let state = createState('Hello world', onStateChange)
      state = selectRange(state, 1, 6)

      let dispatched: EditorState | null = null
      addCommentCommand(state, (tr) => {
        dispatched = state.apply(tr)
      })

      expect(dispatched).not.toBeNull()

      // Check plugin state was updated
      const pluginState = commentPluginKey.getState(dispatched!)
      expect(pluginState!.threads.size).toBe(1)
      expect(pluginState!.showComments).toBe(true)
      expect(pluginState!.activeCommentId).not.toBeNull()

      // The thread should have an empty entries array (new comment)
      const thread = pluginState!.threads.values().next().value!
      expect(thread).toBeDefined()
      expect(thread.entries).toEqual([])

      // Check that the comment mark was applied
      const firstParagraph = dispatched!.doc.firstChild!
      const firstTextNode = firstParagraph.firstChild!
      const commentMark = firstTextNode.marks.find(m => m.type === schema.marks.comment)
      expect(commentMark).toBeDefined()
      expect(commentMark!.attrs.commentId).toBe(thread.id)
    })

    it('calls onStateChange callback when dispatched', () => {
      const onStateChange = vi.fn()
      let state = createState('Hello world', onStateChange)
      state = selectRange(state, 1, 6)

      addCommentCommand(state, (tr) => {
        state.apply(tr)
      })

      expect(onStateChange).toHaveBeenCalled()
      const callArg = onStateChange.mock.calls[0][0]
      expect(callArg.showComments).toBe(true)
      expect(callArg.threads.size).toBe(1)
    })
  })

  describe('state transitions via metadata', () => {
    it('adds an entry to a thread', () => {
      const onStateChange = vi.fn()
      let state = createState('Hello world', onStateChange)
      state = selectRange(state, 1, 6)

      // First add a comment
      addCommentCommand(state, (tr) => {
        state = state.apply(tr)
      })

      const pluginState = commentPluginKey.getState(state)!
      const threadId = pluginState.activeCommentId!

      // Now add an entry
      const tr = state.tr.setMeta(commentPluginKey, {
        addEntry: { commentId: threadId, author: 'alice', text: 'Great work!' }
      } satisfies CommentPluginMeta)
      state = state.apply(tr)

      const updated = commentPluginKey.getState(state)!
      const thread = updated.threads.get(threadId)!
      expect(thread.entries).toHaveLength(1)
      expect(thread.entries[0]).toEqual({ author: 'alice', text: 'Great work!' })
    })

    it('adds multiple entries to a thread', () => {
      const onStateChange = vi.fn()
      let state = createState('Hello world', onStateChange)
      state = selectRange(state, 1, 6)

      addCommentCommand(state, (tr) => {
        state = state.apply(tr)
      })

      const threadId = commentPluginKey.getState(state)!.activeCommentId!

      // Add first reply
      state = state.apply(
        state.tr.setMeta(commentPluginKey, {
          addEntry: { commentId: threadId, author: 'alice', text: 'First' }
        } satisfies CommentPluginMeta)
      )

      // Add second reply
      state = state.apply(
        state.tr.setMeta(commentPluginKey, {
          addEntry: { commentId: threadId, author: 'bob', text: 'Second' }
        } satisfies CommentPluginMeta)
      )

      const thread = commentPluginKey.getState(state)!.threads.get(threadId)!
      expect(thread.entries).toHaveLength(2)
      expect(thread.entries[0].author).toBe('alice')
      expect(thread.entries[1].author).toBe('bob')
    })

    it('ignores addEntry for nonexistent thread', () => {
      const onStateChange = vi.fn()
      let state = createState('Hello', onStateChange)

      const tr = state.tr.setMeta(commentPluginKey, {
        addEntry: { commentId: 'nonexistent', author: 'a', text: 'b' }
      } satisfies CommentPluginMeta)
      state = state.apply(tr)

      expect(commentPluginKey.getState(state)!.threads.size).toBe(0)
    })

    it('resolves a thread by removing it from state', () => {
      const onStateChange = vi.fn()
      let state = createState('Hello world', onStateChange)
      state = selectRange(state, 1, 6)

      addCommentCommand(state, (tr) => {
        state = state.apply(tr)
      })

      const threadId = commentPluginKey.getState(state)!.activeCommentId!
      expect(commentPluginKey.getState(state)!.threads.size).toBe(1)

      // Resolve
      state = state.apply(
        state.tr.setMeta(commentPluginKey, {
          resolveThread: threadId
        } satisfies CommentPluginMeta)
      )

      const ps = commentPluginKey.getState(state)!
      expect(ps.threads.size).toBe(0)
      expect(ps.activeCommentId).toBeNull()
    })

    it('resolving a non-active thread does not clear activeCommentId', () => {
      const onStateChange = vi.fn()
      let state = createState('Hello world foo bar', onStateChange)

      // Add first comment on "Hello"
      state = selectRange(state, 1, 6)
      addCommentCommand(state, (tr) => {
        state = state.apply(tr)
      })
      const firstId = commentPluginKey.getState(state)!.activeCommentId!

      // Add second comment on "world"
      state = selectRange(state, 7, 12)
      addCommentCommand(state, (tr) => {
        state = state.apply(tr)
      })
      const secondId = commentPluginKey.getState(state)!.activeCommentId!

      expect(commentPluginKey.getState(state)!.threads.size).toBe(2)

      // Resolve the first thread (not the active one)
      state = state.apply(
        state.tr.setMeta(commentPluginKey, {
          resolveThread: firstId
        } satisfies CommentPluginMeta)
      )

      const ps = commentPluginKey.getState(state)!
      expect(ps.threads.size).toBe(1)
      // activeCommentId should still be secondId since we resolved firstId
      expect(ps.activeCommentId).toBe(secondId)
    })

    it('toggles showComments', () => {
      const onStateChange = vi.fn()
      let state = createState('Hello', onStateChange)

      expect(commentPluginKey.getState(state)!.showComments).toBe(false)

      state = state.apply(
        state.tr.setMeta(commentPluginKey, { showComments: true } satisfies CommentPluginMeta)
      )
      expect(commentPluginKey.getState(state)!.showComments).toBe(true)

      state = state.apply(
        state.tr.setMeta(commentPluginKey, { showComments: false } satisfies CommentPluginMeta)
      )
      expect(commentPluginKey.getState(state)!.showComments).toBe(false)
    })

    it('sets and clears activeCommentId', () => {
      const onStateChange = vi.fn()
      let state = createState('Hello world', onStateChange)
      state = selectRange(state, 1, 6)

      addCommentCommand(state, (tr) => {
        state = state.apply(tr)
      })

      const threadId = commentPluginKey.getState(state)!.activeCommentId!
      expect(threadId).toBeTruthy()

      // Clear it
      state = state.apply(
        state.tr.setMeta(commentPluginKey, { activeCommentId: null } satisfies CommentPluginMeta)
      )
      expect(commentPluginKey.getState(state)!.activeCommentId).toBeNull()

      // Re-set it
      state = state.apply(
        state.tr.setMeta(commentPluginKey, { activeCommentId: threadId } satisfies CommentPluginMeta)
      )
      expect(commentPluginKey.getState(state)!.activeCommentId).toBe(threadId)
    })

    it('sets and clears context menu', () => {
      const onStateChange = vi.fn()
      let state = createState('Hello', onStateChange)

      state = state.apply(
        state.tr.setMeta(commentPluginKey, { contextMenu: { x: 100, y: 200 } } satisfies CommentPluginMeta)
      )
      expect(commentPluginKey.getState(state)!.contextMenu).toEqual({ x: 100, y: 200 })

      state = state.apply(
        state.tr.setMeta(commentPluginKey, { contextMenu: null } satisfies CommentPluginMeta)
      )
      expect(commentPluginKey.getState(state)!.contextMenu).toBeNull()
    })

    it('replaces threads map entirely', () => {
      const onStateChange = vi.fn()
      let state = createState('Hello', onStateChange)

      const threads = new Map()
      threads.set('t1', { id: 't1', entries: [{ author: 'a', text: 'b' }] })
      threads.set('t2', { id: 't2', entries: [] })

      state = state.apply(
        state.tr.setMeta(commentPluginKey, { threads } satisfies CommentPluginMeta)
      )

      const ps = commentPluginKey.getState(state)!
      expect(ps.threads.size).toBe(2)
      expect(ps.threads.get('t1')!.entries).toHaveLength(1)
      expect(ps.threads.get('t2')!.entries).toHaveLength(0)
    })

    it('does not change state when no meta is set', () => {
      const onStateChange = vi.fn()
      let state = createState('Hello', onStateChange)

      // Set some state first
      state = state.apply(
        state.tr.setMeta(commentPluginKey, { showComments: true } satisfies CommentPluginMeta)
      )

      // Now do a transaction without comment meta (e.g. a text insertion)
      const before = commentPluginKey.getState(state)
      state = state.apply(state.tr.insertText('!', 1))
      const after = commentPluginKey.getState(state)

      // Should be the exact same object reference
      expect(after).toBe(before)
    })
  })
})

describe('Comment Mark in Schema', () => {
  it('has a comment mark type', () => {
    expect(schema.marks.comment).toBeDefined()
  })

  it('creates a mark with commentId attribute', () => {
    const mark = schema.marks.comment.create({ commentId: 'test123' })
    expect(mark.attrs.commentId).toBe('test123')
  })

  it('defaults commentId to empty string', () => {
    const mark = schema.marks.comment.create()
    expect(mark.attrs.commentId).toBe('')
  })

  it('is not inclusive (does not extend to adjacent text)', () => {
    expect(schema.marks.comment.spec.inclusive).toBe(false)
  })

  it('renders as span with data-comment-id and class', () => {
    const mark = schema.marks.comment.create({ commentId: 'abc' })
    const domSpec = mark.type.spec.toDOM!(mark, true) as [string, Record<string, string>, number]
    expect(domSpec[0]).toBe('span')
    expect(domSpec[1]['data-comment-id']).toBe('abc')
    expect(domSpec[1]['class']).toBe('comment-highlight')
  })
})
