/**
 * ProseMirrorEditor Component
 *
 * React wrapper around ProseMirror that provides a WYSIWYG markdown editor.
 * Handles plugin setup, content serialization, diff highlights, slash menu,
 * comment margin, and context menu integration.
 */

import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle } from 'react'
import { EditorState, Transaction } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { history } from 'prosemirror-history'
import { dropCursor } from 'prosemirror-dropcursor'
import { gapCursor } from 'prosemirror-gapcursor'
import { schema } from './schema'
import { markdownParser, markdownSerializer } from './markdown'
import { buildInputRules } from './plugins/inputRules'
import { buildKeymap } from './plugins/keymap'
import { createSlashMenuPlugin, SlashMenuState, slashMenuPluginKey } from './plugins/slashMenu'
import { createPlaceholderPlugin } from './plugins/placeholder'
import { createDiffHighlightPlugin, setDiffHunks, DiffHunk } from './plugins/diffHighlight'
import { createCommentPlugin, CommentPluginState, commentPluginKey, CommentPluginMeta, addCommentCommand } from './plugins/commentPlugin'
import { SlashMenu } from '../components/SlashMenu'
import { CommentMargin } from '../components/CommentMargin/CommentMargin'
import { ContextMenu, ContextMenuItem } from '../components/ContextMenu/ContextMenu'
import { createMermaidNodeView, MermaidNodeView } from './nodeviews/MermaidNodeView'
import { reinitializeMermaidForTheme } from './nodeviews/mermaidRenderer'
import { extractComments, injectComments, CommentThread, CommentInjection } from '../lib/comments'

export interface ProseMirrorEditorHandle {
  getContent: () => string
  setContent: (content: string) => void
  addComment: () => void
  toggleComments: () => void
}

interface ProseMirrorEditorProps {
  initialContent?: string
  filePath?: string | null
  onChange?: (content: string, wordCount: number, charCount: number) => void
  onSave?: () => void
  /** Author name for new comments */
  commentAuthor?: string
}

/**
 * Parses markdown with comment markers, returning a ProseMirror doc
 * with comment marks applied and the extracted thread data.
 */
function parseWithComments(content: string) {
  const { cleaned, comments } = extractComments(content)
  const doc = markdownParser.parse(cleaned)
  if (!doc || comments.length === 0) {
    return { doc, threads: new Map<string, CommentThread>() }
  }

  // Build a mapping from text offset to ProseMirror position.
  // Walk the doc's text nodes and track cumulative text offset.
  const posMap: { textOffset: number; pmPos: number }[] = []
  let textOffset = 0
  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      posMap.push({ textOffset, pmPos: pos })
      textOffset += node.text.length
    }
  })

  // Helper: convert a text offset to a ProseMirror position
  function textOffsetToPos(offset: number): number | null {
    for (let i = posMap.length - 1; i >= 0; i--) {
      if (posMap[i].textOffset <= offset) {
        return posMap[i].pmPos + (offset - posMap[i].textOffset)
      }
    }
    return null
  }

  // Apply comment marks to the doc
  const threads = new Map<string, CommentThread>()
  let tr = EditorState.create({ doc, schema }).tr

  for (const comment of comments) {
    const from = textOffsetToPos(comment.startOffset)
    const to = textOffsetToPos(comment.endOffset)
    if (from === null || to === null) continue

    threads.set(comment.thread.id, comment.thread)
    const mark = schema.marks.comment.create({ commentId: comment.thread.id })
    tr = tr.addMark(from, to, mark)
  }

  return { doc: tr.doc, threads }
}

/**
 * Serializes a ProseMirror doc to markdown, injecting comment markers
 * back for any comment marks found in the document.
 */
function serializeWithComments(
  view: EditorView,
  threads: Map<string, CommentThread>
): string {
  const { doc } = view.state
  const markdown = markdownSerializer.serialize(doc)

  // Collect comment mark positions mapped to text offsets in the serialized markdown.
  // We build the same text-offset mapping as in parsing, then find comment marks.
  const injections: CommentInjection[] = []
  const seen = new Set<string>()

  // Build text-offset map for the doc
  let textOffset = 0
  const posToOffset = new Map<number, number>()
  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) {
        posToOffset.set(pos + i, textOffset + i)
      }
      textOffset += node.text.length
    }
  })

  // Find all comment marks
  doc.descendants((node, pos) => {
    if (!node.isText) return
    const mark = node.marks.find(m => m.type === schema.marks.comment)
    if (!mark) return

    const commentId = mark.attrs.commentId as string
    if (seen.has(commentId)) return
    seen.add(commentId)

    const thread = threads.get(commentId)
    if (!thread || thread.entries.length === 0) return

    // Find the full range of this comment mark
    const markStart = pos
    let markEnd = pos + node.nodeSize

    // Extend to cover all adjacent text nodes with the same comment mark
    doc.nodesBetween(pos, doc.content.size, (n, p) => {
      if (!n.isText) return
      if (n.marks.find(m => m.type === schema.marks.comment && m.attrs.commentId === commentId)) {
        markEnd = Math.max(markEnd, p + n.nodeSize)
      }
    })

    const startOff = posToOffset.get(markStart)
    const endOff = posToOffset.get(markEnd - 1)
    if (startOff === undefined || endOff === undefined) return

    injections.push({
      thread,
      startOffset: startOff,
      endOffset: endOff + 1
    })
  })

  return injectComments(markdown, injections)
}

export const ProseMirrorEditor = forwardRef<ProseMirrorEditorHandle, ProseMirrorEditorProps>(
  ({ initialContent = '', filePath, onChange, onSave, commentAuthor = 'Anonymous' }, ref) => {
    const editorRef = useRef<HTMLDivElement>(null)
    const viewRef = useRef<EditorView | null>(null)
    // Use ref to always have access to the latest onSave callback
    // This avoids stale closure issues where filePath might be null
    const onSaveRef = useRef(onSave)
    onSaveRef.current = onSave

    // Ref to always have latest comment threads for serialization
    const commentThreadsRef = useRef<Map<string, CommentThread>>(new Map())

    const [slashMenuState, setSlashMenuState] = useState<SlashMenuState>({
      active: false,
      query: '',
      items: [],
      selectedIndex: 0,
      position: null
    })

    const [commentState, setCommentState] = useState<CommentPluginState>({
      threads: new Map(),
      activeCommentId: null,
      showComments: false,
      contextMenu: null
    })

    // Keep threads ref in sync with plugin state
    const handleCommentStateChange = useCallback((state: CommentPluginState) => {
      setCommentState(state)
      commentThreadsRef.current = state.threads
    }, [])

    const getContent = useCallback(() => {
      if (!viewRef.current) return ''
      return serializeWithComments(viewRef.current, commentThreadsRef.current)
    }, [])

    const setContent = useCallback((content: string) => {
      if (!viewRef.current) return

      const { doc, threads } = parseWithComments(content)
      if (!doc) return

      const newState = EditorState.create({
        doc,
        plugins: viewRef.current.state.plugins
      })
      viewRef.current.updateState(newState)

      // Load thread data into the comment plugin
      if (threads.size > 0) {
        viewRef.current.dispatch(
          viewRef.current.state.tr.setMeta(commentPluginKey, {
            threads,
            showComments: true
          } satisfies CommentPluginMeta)
        )
      }
    }, [])

    const handleAddComment = useCallback(() => {
      if (!viewRef.current) return
      addCommentCommand(viewRef.current.state, viewRef.current.dispatch.bind(viewRef.current))
    }, [])

    const handleToggleComments = useCallback(() => {
      if (!viewRef.current) return
      const pluginState = commentPluginKey.getState(viewRef.current.state)
      viewRef.current.dispatch(
        viewRef.current.state.tr.setMeta(commentPluginKey, {
          showComments: !pluginState?.showComments
        } satisfies CommentPluginMeta)
      )
    }, [])

    useImperativeHandle(ref, () => ({
      getContent,
      setContent,
      addComment: handleAddComment,
      toggleComments: handleToggleComments
    }))

    const countWords = useCallback((text: string): number => {
      return text
        .trim()
        .split(/\s+/)
        .filter(word => word.length > 0).length
    }, [])

    useEffect(() => {
      if (!editorRef.current) return

      // Parse initial content with comment extraction
      let doc
      let initialThreads = new Map<string, CommentThread>()

      if (initialContent) {
        const result = parseWithComments(initialContent)
        doc = result.doc
        initialThreads = result.threads
      } else {
        doc = schema.nodes.doc.create(null, schema.nodes.paragraph.create())
      }

      // Wrapper that calls the ref to always get latest onSave
      const handleSave = () => onSaveRef.current?.()

      const plugins = [
        buildInputRules(),
        buildKeymap(handleSave),
        history(),
        dropCursor(),
        gapCursor(),
        createSlashMenuPlugin(setSlashMenuState),
        createCommentPlugin(handleCommentStateChange),
        createPlaceholderPlugin(),
        createDiffHighlightPlugin()
      ]

      const state = EditorState.create({
        doc: doc || undefined,
        plugins
      })

      // Track mermaid node views for theme updates
      const mermaidNodeViews: Set<MermaidNodeView> = new Set()

      const view = new EditorView(editorRef.current, {
        state,
        dispatchTransaction(transaction: Transaction) {
          const newState = view.state.apply(transaction)
          view.updateState(newState)

          if (transaction.docChanged && onChange) {
            const markdown = serializeWithComments(view, commentThreadsRef.current)
            const text = newState.doc.textContent
            onChange(markdown, countWords(text), text.length)
          }
        },
        attributes: {
          class: 'prose prose-slate dark:prose-invert max-w-none'
        },
        nodeViews: {
          code_block: (node, view, getPos) => {
            const mermaidView = createMermaidNodeView(node, view, getPos)
            if (mermaidView) {
              mermaidNodeViews.add(mermaidView)
              return mermaidView
            }
            // Return undefined to use default rendering for non-mermaid code blocks
            return undefined as unknown as MermaidNodeView
          }
        }
      })

      viewRef.current = view

      // Load initial comment threads into the plugin
      if (initialThreads.size > 0) {
        commentThreadsRef.current = initialThreads
        view.dispatch(
          view.state.tr.setMeta(commentPluginKey, {
            threads: initialThreads,
            showComments: true
          } satisfies CommentPluginMeta)
        )
      }

      // Focus editor
      view.focus()

      // Emit initial stats
      if (onChange) {
        const text = view.state.doc.textContent
        const markdown = serializeWithComments(view, commentThreadsRef.current)
        onChange(markdown, countWords(text), text.length)
      }

      // Watch for theme changes (dark class toggle on html element)
      // to re-render mermaid diagrams with correct colors
      const themeObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.attributeName === 'class') {
            // Theme changed, re-initialize mermaid and re-render diagrams
            reinitializeMermaidForTheme()
            mermaidNodeViews.forEach((nodeView) => {
              nodeView.reRenderForTheme()
            })
          }
        }
      })

      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class']
      })

      return () => {
        themeObserver.disconnect()
        mermaidNodeViews.clear()
        view.destroy()
        viewRef.current = null
      }
    }, []) // Only run on mount

    // Load diff data when file path changes
    const loadDiffData = useCallback(async () => {
      if (!viewRef.current || !filePath) {
        // Clear diff highlights if no file
        if (viewRef.current) {
          setDiffHunks(viewRef.current, [])
        }
        return
      }

      try {
        const result = await window.electron.explorer.getFileDiff(filePath)
        if (result.success && result.hunks && viewRef.current) {
          setDiffHunks(viewRef.current, result.hunks as DiffHunk[])
        }
      } catch {
        // Silently ignore diff errors
      }
    }, [filePath])

    // Load diff data when file path changes
    useEffect(() => {
      loadDiffData()
    }, [loadDiffData])

    // Handle slash menu item selection
    const handleSlashMenuSelect = useCallback((item: { action: (view: EditorView) => void }) => {
      if (!viewRef.current) return

      const view = viewRef.current

      // Delete the slash and query
      const { $from } = view.state.selection
      const textBefore = $from.parent.textContent.slice(0, $from.parentOffset)
      const slashIndex = textBefore.lastIndexOf('/')
      const from = $from.pos - (textBefore.length - slashIndex)
      const tr = view.state.tr.delete(from, $from.pos)
      view.dispatch(tr.setMeta(slashMenuPluginKey, { active: false, query: '', selectedIndex: 0, position: null }))

      item.action(view)
    }, [])

    // Close context menu
    const handleCloseContextMenu = useCallback(() => {
      if (!viewRef.current) return
      viewRef.current.dispatch(
        viewRef.current.state.tr.setMeta(commentPluginKey, {
          contextMenu: null
        } satisfies CommentPluginMeta)
      )
    }, [])

    // Build context menu items
    const contextMenuItems: ContextMenuItem[] = [
      {
        id: 'addComment',
        label: 'Add Comment',
        shortcut: '\u2318\u2325M',
        action: () => {
          handleAddComment()
          handleCloseContextMenu()
        }
      }
    ]

    const hasComments = commentState.showComments && commentState.threads.size > 0

    return (
      <div className="relative h-full">
        <div
          ref={editorRef}
          className={`h-full overflow-auto thin-scrollbar${commentState.showComments ? '' : ' comments-hidden'}`}
          style={hasComments ? { paddingRight: '300px' } : undefined}
        />
        <SlashMenu
          state={slashMenuState}
          onSelect={handleSlashMenuSelect}
        />
        {/* Comment margin panel */}
        <CommentMargin
          view={viewRef.current}
          commentState={commentState}
          author={commentAuthor}
          filePath={filePath}
        />
        {/* Right-click context menu */}
        {commentState.contextMenu && (
          <ContextMenu
            items={contextMenuItems}
            position={commentState.contextMenu}
            onClose={handleCloseContextMenu}
          />
        )}
      </div>
    )
  }
)

ProseMirrorEditor.displayName = 'ProseMirrorEditor'
