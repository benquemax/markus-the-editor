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
import { SlashMenu } from '../components/SlashMenu'

export interface ProseMirrorEditorHandle {
  getContent: () => string
  setContent: (content: string) => void
}

interface ProseMirrorEditorProps {
  initialContent?: string
  filePath?: string | null
  onChange?: (content: string, wordCount: number, charCount: number) => void
  onSave?: () => void
}

export const ProseMirrorEditor = forwardRef<ProseMirrorEditorHandle, ProseMirrorEditorProps>(
  ({ initialContent = '', filePath, onChange, onSave }, ref) => {
    const editorRef = useRef<HTMLDivElement>(null)
    const viewRef = useRef<EditorView | null>(null)
    // Use ref to always have access to the latest onSave callback
    // This avoids stale closure issues where filePath might be null
    const onSaveRef = useRef(onSave)
    onSaveRef.current = onSave

    const [slashMenuState, setSlashMenuState] = useState<SlashMenuState>({
      active: false,
      query: '',
      items: [],
      selectedIndex: 0,
      position: null
    })

    const getContent = useCallback(() => {
      if (!viewRef.current) return ''
      return markdownSerializer.serialize(viewRef.current.state.doc)
    }, [])

    const setContent = useCallback((content: string) => {
      if (!viewRef.current) return

      const doc = markdownParser.parse(content)
      if (!doc) return

      const newState = EditorState.create({
        doc,
        plugins: viewRef.current.state.plugins
      })
      viewRef.current.updateState(newState)
    }, [])

    useImperativeHandle(ref, () => ({
      getContent,
      setContent
    }))

    const countWords = useCallback((text: string): number => {
      return text
        .trim()
        .split(/\s+/)
        .filter(word => word.length > 0).length
    }, [])

    useEffect(() => {
      if (!editorRef.current) return

      // Parse initial content
      const doc = initialContent
        ? markdownParser.parse(initialContent)
        : schema.nodes.doc.create(null, schema.nodes.paragraph.create())

      // Wrapper that calls the ref to always get latest onSave
      const handleSave = () => onSaveRef.current?.()

      const plugins = [
        buildInputRules(),
        buildKeymap(handleSave),
        history(),
        dropCursor(),
        gapCursor(),
        createSlashMenuPlugin(setSlashMenuState),
        createPlaceholderPlugin(),
        createDiffHighlightPlugin()
      ]

      const state = EditorState.create({
        doc: doc || undefined,
        plugins
      })

      const view = new EditorView(editorRef.current, {
        state,
        dispatchTransaction(transaction: Transaction) {
          const newState = view.state.apply(transaction)
          view.updateState(newState)

          if (transaction.docChanged && onChange) {
            const markdown = markdownSerializer.serialize(newState.doc)
            const text = newState.doc.textContent
            onChange(markdown, countWords(text), text.length)
          }
        },
        attributes: {
          class: 'prose prose-slate dark:prose-invert max-w-none'
        }
      })

      viewRef.current = view

      // Focus editor
      view.focus()

      // Emit initial stats
      if (onChange) {
        const text = view.state.doc.textContent
        const markdown = markdownSerializer.serialize(view.state.doc)
        onChange(markdown, countWords(text), text.length)
      }

      return () => {
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

    return (
      <div className="relative h-full">
        <div ref={editorRef} className="h-full overflow-auto thin-scrollbar" />
        <SlashMenu
          state={slashMenuState}
          onSelect={handleSlashMenuSelect}
        />
      </div>
    )
  }
)

ProseMirrorEditor.displayName = 'ProseMirrorEditor'
