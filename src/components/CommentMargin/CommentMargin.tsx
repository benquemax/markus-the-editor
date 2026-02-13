/**
 * CommentMargin Component
 *
 * Right-side margin panel that displays comment threads aligned with their
 * highlighted text in the editor. Positioned absolutely inside the editor
 * container and uses EditorView.coordsAtPos() for vertical alignment.
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { EditorView } from 'prosemirror-view'
import { schema } from '../../editor/schema'
import { CommentThread } from '../../lib/comments'
import { CommentThreadView } from './CommentThread'
import { CommentPluginState, commentPluginKey, CommentPluginMeta, removeCommentMark } from '../../editor/plugins/commentPlugin'
import { sendCommentToAgent } from '../../lib/commentAgentBridge'

interface CommentMarginProps {
  view: EditorView | null
  commentState: CommentPluginState
  author: string
  filePath?: string | null
}

interface PositionedThread {
  thread: CommentThread
  top: number
}

export function CommentMargin({ view, commentState, author, filePath }: CommentMarginProps) {
  const [positionedThreads, setPositionedThreads] = useState<PositionedThread[]>([])
  const marginRef = useRef<HTMLDivElement>(null)

  const calculatePositions = useCallback(() => {
    if (!view) return

    const positioned: PositionedThread[] = []
    const editorRect = view.dom.getBoundingClientRect()
    const { doc } = view.state

    // Walk the document finding comment marks and their positions
    doc.descendants((node, pos) => {
      if (!node.isText) return
      const mark = node.marks.find(m => m.type === schema.marks.comment)
      if (!mark) return

      const commentId = mark.attrs.commentId
      const thread = commentState.threads.get(commentId)
      if (!thread) return

      // Avoid duplicates (same thread can span multiple text nodes)
      if (positioned.find(p => p.thread.id === commentId)) return

      try {
        const coords = view.coordsAtPos(pos)
        // Position relative to the editor container
        const top = coords.top - editorRect.top
        positioned.push({ thread, top })
      } catch {
        // Position might be invalid during updates
      }
    })

    // Sort by vertical position
    positioned.sort((a, b) => a.top - b.top)

    // Prevent overlapping: ensure minimum spacing between threads
    const minSpacing = 80
    for (let i = 1; i < positioned.length; i++) {
      if (positioned[i].top < positioned[i - 1].top + minSpacing) {
        positioned[i].top = positioned[i - 1].top + minSpacing
      }
    }

    setPositionedThreads(positioned)
  }, [view, commentState.threads])

  // Recalculate on state changes
  useEffect(() => {
    calculatePositions()
  }, [calculatePositions])

  // Recalculate on scroll
  useEffect(() => {
    if (!view) return
    const editorDom = view.dom.closest('.overflow-auto')
    if (!editorDom) return

    const handleScroll = () => calculatePositions()
    editorDom.addEventListener('scroll', handleScroll)
    return () => editorDom.removeEventListener('scroll', handleScroll)
  }, [view, calculatePositions])

  const handleActivate = useCallback((commentId: string) => {
    if (!view) return
    const currentId = commentState.activeCommentId
    const newId = currentId === commentId ? null : commentId
    view.dispatch(
      view.state.tr.setMeta(commentPluginKey, {
        activeCommentId: newId
      } satisfies CommentPluginMeta)
    )
  }, [view, commentState.activeCommentId])

  const handleAddReply = useCallback((commentId: string, text: string) => {
    if (!view) return
    view.dispatch(
      view.state.tr.setMeta(commentPluginKey, {
        addEntry: { commentId, author, text }
      } satisfies CommentPluginMeta)
    )

    // If @markus is mentioned, send the highlighted text and comment to agent
    if (text.toLowerCase().includes('@markus')) {
      // Find the highlighted text for this comment
      let highlightedText = ''
      view.state.doc.descendants((node) => {
        if (!node.isText) return
        const mark = node.marks.find(m =>
          m.type === schema.marks.comment && m.attrs.commentId === commentId
        )
        if (mark && node.text) {
          highlightedText += node.text
        }
      })

      sendCommentToAgent({
        highlightedText,
        commentText: text,
        author,
        filePath
      })
    }
  }, [view, author, filePath])

  const handleResolve = useCallback((commentId: string) => {
    if (!view) return
    removeCommentMark(view, commentId)
  }, [view])

  if (!commentState.showComments || positionedThreads.length === 0) {
    return null
  }

  return (
    <div
      ref={marginRef}
      className="absolute right-0 top-0 w-[280px] h-full overflow-y-auto thin-scrollbar px-2 py-2 space-y-2"
    >
      {positionedThreads.map(({ thread, top }) => (
        <div
          key={thread.id}
          style={{ position: 'absolute', top, right: 8, left: 8 }}
        >
          <CommentThreadView
            thread={thread}
            isActive={commentState.activeCommentId === thread.id}
            onClick={() => handleActivate(thread.id)}
            onAddReply={(text) => handleAddReply(thread.id, text)}
            onResolve={() => handleResolve(thread.id)}
          />
        </div>
      ))}
    </div>
  )
}
