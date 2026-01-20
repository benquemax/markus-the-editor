/**
 * Main ProseMirror editor component.
 * Wraps the ProseMirror editor view in a React component, handling initialization,
 * state management, and integration with the rest of the application.
 * Supports markdown parsing/serialization, slash commands, and table editing.
 */
import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle } from 'react'
import { EditorState, Transaction } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { history } from 'prosemirror-history'
import { dropCursor } from 'prosemirror-dropcursor'
import { gapCursor } from 'prosemirror-gapcursor'
import { tableEditing, columnResizing } from 'prosemirror-tables'
import { schema } from './schema'
import { markdownParser, markdownSerializer } from './markdown'
import { buildInputRules } from './plugins/inputRules'
import { buildKeymap } from './plugins/keymap'
import { createSlashMenuPlugin, SlashMenuState, slashMenuPluginKey } from './plugins/slashMenu'
import { createPlaceholderPlugin } from './plugins/placeholder'
import { createDeletionConfirmPlugin } from './plugins/deletionConfirm'
import { createTableControlsPlugin, TableControlsState } from './plugins/tableControls'
import { SlashMenu } from '../components/SlashMenu'
import { Toast } from '../components/Toast'
import { TableControls } from '../components/TableControls'

export interface ProseMirrorEditorHandle {
  getContent: () => string
  setContent: (content: string) => void
}

interface ProseMirrorEditorProps {
  initialContent?: string
  onChange?: (content: string, wordCount: number, charCount: number) => void
  onSave?: () => void
}

export const ProseMirrorEditor = forwardRef<ProseMirrorEditorHandle, ProseMirrorEditorProps>(
  ({ initialContent = '', onChange, onSave }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null)
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

    const [tableControlsState, setTableControlsState] = useState<TableControlsState>({
      active: false,
      tablePos: -1,
      rowCount: 0,
      colCount: 0,
      currentRow: -1,
      currentCol: -1,
      tableRect: null,
      rowPositions: [],
      colPositions: []
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
        // Slash menu must be before keymap so it can intercept Enter/Arrow keys
        // when the menu is active, before keymap handles them
        createSlashMenuPlugin(setSlashMenuState),
        // Deletion confirm plugin handles double-backspace pattern for tables, blockquotes, code blocks
        createDeletionConfirmPlugin(),
        buildKeymap(handleSave),
        history(),
        dropCursor(),
        gapCursor(),
        createPlaceholderPlugin(),
        // Table editing plugins - provide cell navigation, selection, and editing
        columnResizing(),
        tableEditing(),
        // Table controls plugin tracks cursor position in tables for UI controls
        createTableControlsPlugin(setTableControlsState)
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
      <div ref={containerRef} className="relative h-full">
        <div ref={editorRef} className="h-full overflow-auto" />
        <TableControls
          state={tableControlsState}
          view={viewRef.current}
          containerRef={containerRef as React.RefObject<HTMLDivElement>}
        />
        <SlashMenu
          state={slashMenuState}
          onSelect={handleSlashMenuSelect}
        />
        <Toast />
      </div>
    )
  }
)

ProseMirrorEditor.displayName = 'ProseMirrorEditor'
