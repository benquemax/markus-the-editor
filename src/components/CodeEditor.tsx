/**
 * CodeMirror-based code editor for raw markdown editing.
 * Features:
 * - Markdown syntax highlighting with HTML support
 * - Vim mode with custom ex commands (:w, :x, :q)
 * - Caps Lock interception to toggle vim mode (acts as Esc)
 * - Block cursor for normal/command mode, line cursor for insert mode
 * - Markdown validation with error highlighting
 * - Red tint background when markdown is invalid
 */
import { useEffect, useRef, useCallback, useState } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState, Extension } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { linter, Diagnostic, lintGutter } from '@codemirror/lint'
import { vim, Vim, getCM } from '@replit/codemirror-vim'
import { markdownParser } from '../editor/markdown'

interface CodeEditorProps {
  /** Current markdown content */
  content: string
  /** Callback when content changes (only called with valid markdown) */
  onChange: (content: string) => void
  /** Callback to save the document */
  onSave: () => void
  /** Callback to close the code editor */
  onClose: () => void
  /** Whether dark theme is active */
  isDark: boolean
  /** Callback when markdown validation state changes */
  onValidationChange?: (isValid: boolean) => void
}

interface MarkdownError {
  line: number
  message: string
}

/**
 * Validate markdown content using our parser.
 * Returns validation result with any errors found.
 */
function validateMarkdown(content: string): { valid: boolean; errors: MarkdownError[] } {
  try {
    const doc = markdownParser.parse(content)
    if (!doc) {
      return { valid: false, errors: [{ line: 1, message: 'Failed to parse markdown' }] }
    }
    return { valid: true, errors: [] }
  } catch (e) {
    // Try to extract line number from error if available
    const errorMessage = e instanceof Error ? e.message : String(e)
    return { valid: false, errors: [{ line: 1, message: errorMessage }] }
  }
}

/**
 * Create a linter extension for markdown validation.
 * Shows errors inline in the editor with wavy underlines.
 */
function createMarkdownLinter(onValidationChange: (valid: boolean, errors: MarkdownError[]) => void) {
  return linter((view) => {
    const content = view.state.doc.toString()
    const { valid, errors } = validateMarkdown(content)

    // Notify parent of validation state
    onValidationChange(valid, errors)

    // Convert errors to CodeMirror diagnostics
    const diagnostics: Diagnostic[] = errors.map((err) => {
      const lineCount = view.state.doc.lines
      const safeLine = Math.min(Math.max(1, err.line), lineCount)
      const line = view.state.doc.line(safeLine)
      return {
        from: line.from,
        to: line.to,
        severity: 'error',
        message: err.message
      }
    })

    return diagnostics
  }, { delay: 300 }) // Debounce validation
}

/**
 * Create dark theme for CodeMirror.
 */
function createDarkTheme(): Extension {
  return EditorView.theme({
    '&': {
      backgroundColor: 'hsl(222.2 84% 4.9%)',
      color: 'hsl(210 40% 98%)'
    },
    '.cm-content': {
      caretColor: 'hsl(210 40% 98%)'
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'hsl(210 40% 98%)'
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'hsl(217.2 32.6% 25%)'
    },
    '.cm-activeLine': {
      backgroundColor: 'hsl(217.2 32.6% 12%)'
    },
    '.cm-gutters': {
      backgroundColor: 'hsl(222.2 84% 4.9%)',
      color: 'hsl(215 20.2% 55%)',
      borderRight: '1px solid hsl(217.2 32.6% 17.5%)'
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'hsl(217.2 32.6% 12%)'
    },
    // Vim status line
    '.cm-vim-panel': {
      backgroundColor: 'hsl(217.2 32.6% 17.5%)',
      color: 'hsl(210 40% 98%)',
      padding: '2px 8px'
    }
  }, { dark: true })
}

/**
 * Create light theme for CodeMirror.
 */
function createLightTheme(): Extension {
  return EditorView.theme({
    '&': {
      backgroundColor: 'hsl(0 0% 100%)',
      color: 'hsl(222.2 84% 4.9%)'
    },
    '.cm-content': {
      caretColor: 'hsl(222.2 84% 4.9%)'
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'hsl(222.2 84% 4.9%)'
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'hsl(214.3 31.8% 85%)'
    },
    '.cm-activeLine': {
      backgroundColor: 'hsl(210 40% 96.1%)'
    },
    '.cm-gutters': {
      backgroundColor: 'hsl(0 0% 100%)',
      color: 'hsl(215.4 16.3% 46.9%)',
      borderRight: '1px solid hsl(214.3 31.8% 91.4%)'
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'hsl(210 40% 96.1%)'
    },
    // Vim status line
    '.cm-vim-panel': {
      backgroundColor: 'hsl(210 40% 96.1%)',
      color: 'hsl(222.2 84% 4.9%)',
      padding: '2px 8px'
    }
  }, { dark: false })
}

export function CodeEditor({ content, onChange, onSave, onClose, isDark, onValidationChange }: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [isValid, setIsValid] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [vimMode, setVimMode] = useState<'normal' | 'insert' | 'visual' | 'replace'>('normal')

  // Track pending content that hasn't been synced to parent yet
  const pendingContentRef = useRef<string | null>(null)
  // Track whether we're syncing content from parent (to avoid calling onChange for synced content)
  const isSyncingFromParentRef = useRef(false)

  // Refs for callbacks to avoid stale closures
  const onSaveRef = useRef(onSave)
  const onCloseRef = useRef(onClose)
  const onChangeRef = useRef(onChange)
  const onValidationChangeRef = useRef(onValidationChange)
  onSaveRef.current = onSave
  onCloseRef.current = onClose
  onChangeRef.current = onChange
  onValidationChangeRef.current = onValidationChange

  // Handle validation state changes
  const handleValidationChange = useCallback((valid: boolean, errors: MarkdownError[]) => {
    setIsValid(valid)
    // Notify parent of validation state change
    onValidationChangeRef.current?.(valid)

    if (valid) {
      setErrorMessage(null)
      // Sync valid content to parent, but only if it came from user editing in code editor
      // (not from a sync from parent/WYSIWYG)
      if (pendingContentRef.current !== null && !isSyncingFromParentRef.current) {
        onChangeRef.current(pendingContentRef.current)
        pendingContentRef.current = null
      }
    } else {
      setErrorMessage(errors[0]?.message || 'Invalid markdown')
    }
  }, [])

  // Initialize CodeMirror
  useEffect(() => {
    if (!containerRef.current) return

    // Define custom ex commands before creating editor
    Vim.defineEx('w', 'w', () => {
      onSaveRef.current()
    })

    Vim.defineEx('x', 'x', () => {
      onSaveRef.current()
      onCloseRef.current()
    })

    Vim.defineEx('q', 'q', () => {
      onCloseRef.current()
    })

    Vim.defineEx('wq', 'wq', () => {
      onSaveRef.current()
      onCloseRef.current()
    })

    const theme = isDark ? createDarkTheme() : createLightTheme()

    const state = EditorState.create({
      doc: content,
      extensions: [
        vim(),
        basicSetup,
        markdown({ codeLanguages: languages }),
        theme,
        lintGutter(),
        createMarkdownLinter(handleValidationChange),
        EditorView.updateListener.of((update) => {
          // Only track changes from user edits, not from parent syncs
          if (update.docChanged && !isSyncingFromParentRef.current) {
            const newContent = update.state.doc.toString()
            pendingContentRef.current = newContent
          }
        }),
        // Track vim mode changes for cursor styling
        EditorView.updateListener.of(() => {
          if (viewRef.current) {
            const cm = getCM(viewRef.current)
            if (cm) {
              const vimState = cm.state?.vim
              if (vimState) {
                const mode = vimState.insertMode ? 'insert'
                  : vimState.visualMode ? 'visual'
                  : 'normal'
                setVimMode(mode)
              }
            }
          }
        })
      ]
    })

    const view = new EditorView({
      state,
      parent: containerRef.current
    })

    viewRef.current = view

    // Focus the editor
    view.focus()

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // We intentionally only re-create the editor when the theme changes.
    // Content sync is handled by a separate useEffect that updates the editor's doc.
    // handleValidationChange is stable via useCallback, but including it causes
    // unnecessary re-creates. The initial 'content' prop is only used on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDark])

  // Handle Caps Lock as Escape for vim mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'CapsLock' && viewRef.current) {
        e.preventDefault()
        // Get the CodeMirror vim instance and exit insert mode
        const cm = getCM(viewRef.current)
        if (cm) {
          // Dispatch Escape key to exit insert mode
          const escEvent = new KeyboardEvent('keydown', {
            key: 'Escape',
            code: 'Escape',
            keyCode: 27,
            which: 27,
            bubbles: true
          })
          viewRef.current.contentDOM.dispatchEvent(escEvent)
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Sync content from parent when it changes externally
  useEffect(() => {
    if (viewRef.current) {
      const currentContent = viewRef.current.state.doc.toString()
      if (content !== currentContent && content !== pendingContentRef.current) {
        // Mark that we're syncing from parent so we don't call onChange back
        isSyncingFromParentRef.current = true
        const transaction = viewRef.current.state.update({
          changes: {
            from: 0,
            to: currentContent.length,
            insert: content
          }
        })
        viewRef.current.dispatch(transaction)
        // Reset the flag after a microtask to allow the linter to run
        queueMicrotask(() => {
          isSyncingFromParentRef.current = false
        })
      }
    }
  }, [content])

  // Determine wrapper class based on validation state
  const wrapperClass = `code-editor-wrapper h-full flex flex-col ${!isValid ? 'has-errors' : ''}`

  return (
    <div className={wrapperClass}>
      {/* Editor container */}
      <div
        ref={containerRef}
        className={`flex-1 overflow-auto code-editor-container ${vimMode === 'insert' ? 'vim-insert' : 'vim-normal'}`}
      />

      {/* Error status bar */}
      {!isValid && errorMessage && (
        <div className="code-editor-error-bar">
          <span className="error-icon">⚠</span>
          <span className="error-message">{errorMessage}</span>
        </div>
      )}
    </div>
  )
}
