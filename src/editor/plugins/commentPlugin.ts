/**
 * Comment Plugin
 *
 * ProseMirror plugin that manages comment thread state and click interaction.
 * Tracks all comment threads, the currently active (open) thread, and
 * visibility toggle. Follows the same pattern as diffHighlight.ts and slashMenu.ts:
 * state updates via transaction metadata, React callback for state lifting.
 */

import { Plugin, PluginKey, EditorState, Transaction } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { schema } from '../schema'
import { CommentThread, generateCommentId } from '../../lib/comments'

// ============================================================================
// Types
// ============================================================================

export interface CommentPluginState {
  /** All comment threads keyed by ID */
  threads: Map<string, CommentThread>
  /** Currently active (open in margin) thread ID */
  activeCommentId: string | null
  /** Whether the comment margin is visible */
  showComments: boolean
  /** Context menu state for right-click */
  contextMenu: { x: number; y: number } | null
}

/** Metadata shape for updating plugin state via transactions */
export interface CommentPluginMeta {
  threads?: Map<string, CommentThread>
  activeCommentId?: string | null
  showComments?: boolean
  contextMenu?: { x: number; y: number } | null
  /** Add a new entry to an existing thread */
  addEntry?: { commentId: string; author: string; text: string }
  /** Resolve (delete) a thread — the mark removal is handled separately */
  resolveThread?: string
}

// ============================================================================
// Plugin Key
// ============================================================================

export const commentPluginKey = new PluginKey<CommentPluginState>('comments')

// ============================================================================
// Commands
// ============================================================================

/**
 * ProseMirror command that adds a comment mark to the current selection.
 * Opens the comment margin with a new empty thread.
 */
export function addCommentCommand(
  state: EditorState,
  dispatch?: (tr: Transaction) => void
): boolean {
  const { from, to, empty } = state.selection
  if (empty) return false

  if (dispatch) {
    const id = generateCommentId()
    const commentMark = schema.marks.comment.create({ commentId: id })
    const tr = state.tr.addMark(from, to, commentMark)

    // Create the new thread and activate it
    const pluginState = commentPluginKey.getState(state)
    const threads = new Map(pluginState?.threads ?? [])
    threads.set(id, { id, entries: [] })

    tr.setMeta(commentPluginKey, {
      threads,
      activeCommentId: id,
      showComments: true
    } satisfies CommentPluginMeta)

    dispatch(tr)
  }

  return true
}

/**
 * Removes the comment mark for a given thread ID from the document.
 * The text remains intact — only the mark is stripped.
 */
export function removeCommentMark(view: EditorView, commentId: string): void {
  const { state } = view
  const { doc } = state
  let tr = state.tr

  // Walk the doc and remove the comment mark matching this ID
  doc.descendants((node, pos) => {
    if (!node.isText) return
    const mark = node.marks.find(
      m => m.type === schema.marks.comment && m.attrs.commentId === commentId
    )
    if (mark) {
      tr = tr.removeMark(pos, pos + node.nodeSize, mark)
    }
  })

  // Remove the thread from plugin state
  const pluginState = commentPluginKey.getState(state)
  if (pluginState) {
    const threads = new Map(pluginState.threads)
    threads.delete(commentId)
    tr.setMeta(commentPluginKey, {
      threads,
      activeCommentId: null
    } satisfies CommentPluginMeta)
  }

  view.dispatch(tr)
}

// ============================================================================
// Plugin Factory
// ============================================================================

export function createCommentPlugin(
  onStateChange: (state: CommentPluginState) => void
) {
  return new Plugin<CommentPluginState>({
    key: commentPluginKey,

    state: {
      init(): CommentPluginState {
        return {
          threads: new Map(),
          activeCommentId: null,
          showComments: false,
          contextMenu: null
        }
      },

      apply(tr, prev): CommentPluginState {
        const meta = tr.getMeta(commentPluginKey) as CommentPluginMeta | undefined

        if (meta) {
          const newState = { ...prev }

          // Update threads
          if (meta.threads !== undefined) {
            newState.threads = meta.threads
          }

          // Add entry to a thread
          if (meta.addEntry) {
            const { commentId, author, text } = meta.addEntry
            const threads = new Map(newState.threads)
            const thread = threads.get(commentId)
            if (thread) {
              threads.set(commentId, {
                ...thread,
                entries: [...thread.entries, { author, text }]
              })
              newState.threads = threads
            }
          }

          // Resolve a thread
          if (meta.resolveThread) {
            const threads = new Map(newState.threads)
            threads.delete(meta.resolveThread)
            newState.threads = threads
            if (newState.activeCommentId === meta.resolveThread) {
              newState.activeCommentId = null
            }
          }

          if (meta.activeCommentId !== undefined) {
            newState.activeCommentId = meta.activeCommentId
          }
          if (meta.showComments !== undefined) {
            newState.showComments = meta.showComments
          }
          if (meta.contextMenu !== undefined) {
            newState.contextMenu = meta.contextMenu
          }

          onStateChange(newState)
          return newState
        }

        return prev
      }
    },

    props: {
      handleClick(view, pos) {
        // Check if the click is on a comment-marked text
        const { doc } = view.state
        const $pos = doc.resolve(pos)
        const marks = $pos.marks()
        const commentMark = marks.find(m => m.type === schema.marks.comment)

        const pluginState = commentPluginKey.getState(view.state)
        if (!pluginState) return false

        if (commentMark) {
          const commentId = commentMark.attrs.commentId
          // Toggle: if clicking the already-active comment, deactivate
          const newActiveId = pluginState.activeCommentId === commentId ? null : commentId
          view.dispatch(
            view.state.tr.setMeta(commentPluginKey, {
              activeCommentId: newActiveId,
              showComments: newActiveId !== null ? true : pluginState.showComments
            } satisfies CommentPluginMeta)
          )
          return false // don't prevent default selection behavior
        } else {
          // Clicked outside any comment — close context menu
          if (pluginState.contextMenu) {
            view.dispatch(
              view.state.tr.setMeta(commentPluginKey, {
                contextMenu: null
              } satisfies CommentPluginMeta)
            )
          }
        }

        return false
      },

      handleDOMEvents: {
        contextmenu(view, event) {
          const { state } = view
          const { from, to, empty } = state.selection

          // Only show context menu if there's a text selection
          if (empty || from === to) return false

          event.preventDefault()

          const mouseEvent = event as MouseEvent
          view.dispatch(
            state.tr.setMeta(commentPluginKey, {
              contextMenu: { x: mouseEvent.clientX, y: mouseEvent.clientY }
            } satisfies CommentPluginMeta)
          )

          return true
        }
      }
    }
  })
}
