import { useState, useEffect, useCallback, useRef } from 'react'
import { ProseMirrorEditor, ProseMirrorEditorHandle } from './editor/ProseMirrorEditor'
import { StatusBar } from './components/StatusBar'
import { CommandPalette } from './components/CommandPalette'
import { GitPanel } from './components/GitPanel'
import { CodeEditor } from './components/CodeEditor'
import { CodeEditorFab } from './components/CodeEditorFab'
import { cn } from './lib/utils'
import { markdownParser } from './editor/markdown'
import { showToast } from './lib/toast'

type Theme = 'light' | 'dark' | 'system'

function App() {
  const [content, setContent] = useState('')
  const [filePath, setFilePath] = useState<string | null>(null)
  const [wordCount, setWordCount] = useState(0)
  const [charCount, setCharCount] = useState(0)
  const [isDirty, setIsDirty] = useState(false)
  const [theme, setTheme] = useState<Theme>('system')
  const [showCodeEditor, setShowCodeEditor] = useState(false)
  const [isMarkdownValid, setIsMarkdownValid] = useState(true)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [showGitPanel, setShowGitPanel] = useState(false)
  const [isGitRepo, setIsGitRepo] = useState(false)
  const editorRef = useRef<ProseMirrorEditorHandle>(null)

  // Validate markdown content
  const validateMarkdown = useCallback((content: string): boolean => {
    try {
      const doc = markdownParser.parse(content)
      return doc !== null
    } catch {
      return false
    }
  }, [])

  // Apply theme
  useEffect(() => {
    const root = document.documentElement
    const applyTheme = (t: Theme) => {
      if (t === 'system') {
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
        root.classList.toggle('dark', isDark)
      } else {
        root.classList.toggle('dark', t === 'dark')
      }
    }

    applyTheme(theme)

    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      const handler = () => applyTheme('system')
      mediaQuery.addEventListener('change', handler)
      return () => mediaQuery.removeEventListener('change', handler)
    }
  }, [theme])

  // Load saved theme
  useEffect(() => {
    window.electron.store.get('theme').then((savedTheme: unknown) => {
      if (savedTheme) setTheme(savedTheme as Theme)
    })
  }, [])

  // Save theme when changed
  useEffect(() => {
    window.electron.store.set('theme', theme)
  }, [theme])

  // Check if in git repo when file path changes
  useEffect(() => {
    if (filePath) {
      window.electron.git.isRepo().then(setIsGitRepo)
    } else {
      setIsGitRepo(false)
    }
  }, [filePath])

  // Handle file operations from main process
  useEffect(() => {
    const unsubNew = window.electron.file.onNew(() => {
      setContent('')
      setFilePath(null)
      setIsDirty(false)
      setIsMarkdownValid(true)
      setShowCodeEditor(false)
      editorRef.current?.setContent('')
    })

    const unsubOpened = window.electron.file.onOpened((data: { content: string; filePath: string }) => {
      const { content: fileContent, filePath: path } = data
      setContent(fileContent)
      setFilePath(path)
      setIsDirty(false)

      // Validate markdown on file open
      const isValid = validateMarkdown(fileContent)
      setIsMarkdownValid(isValid)

      if (isValid) {
        // Valid markdown - render normally
        editorRef.current?.setContent(fileContent)
      } else {
        // Invalid markdown - show toast and open code editor
        showToast('Invalid markdown syntax. Please fix in code editor.', 4000)
        setShowCodeEditor(true)
      }
    })

    const unsubRequestContent = window.electron.file.onRequestContent(async () => {
      const currentContent = editorRef.current?.getContent() || content
      const result = await window.electron.file.save(currentContent)
      if (result.success) {
        setIsDirty(false)
      }
    })

    const unsubExternalChange = window.electron.file.onExternalChange(async (data: { content: string }) => {
      const { content: externalContent } = data
      const result = await window.electron.dialog.showMessage({
        type: 'question',
        title: 'File Changed',
        message: 'The file has been modified externally. Do you want to reload it?',
        buttons: ['Reload', 'Ignore']
      })

      if (result.response === 0) {
        setContent(externalContent)
        editorRef.current?.setContent(externalContent)
        setIsDirty(false)
      }
    })

    return () => {
      unsubNew()
      unsubOpened()
      unsubRequestContent()
      unsubExternalChange()
    }
  }, [content, validateMarkdown])

  // Handle menu events
  useEffect(() => {
    const unsubTheme = window.electron.menu.onToggleTheme(setTheme)
    const unsubSplit = window.electron.menu.onToggleSplitView(() => setShowCodeEditor(v => !v))
    const unsubPalette = window.electron.menu.onOpenCommandPalette(() => setShowCommandPalette(true))

    return () => {
      unsubTheme()
      unsubSplit()
      unsubPalette()
    }
  }, [])

  // Handle Save As
  const handleSaveAs = useCallback(async () => {
    const currentContent = editorRef.current?.getContent() || content
    const result = await window.electron.file.saveAs(currentContent)
    if (result.success && result.filePath) {
      setFilePath(result.filePath)
      setIsDirty(false)
    }
  }, [content])

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        e.preventDefault()
        setShowCommandPalette(true)
      }
      // Ctrl+Shift+S for Save As
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'S') {
        e.preventDefault()
        handleSaveAs()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSaveAs])

  // Handle drag and drop
  useEffect(() => {
    const handleDrop = async (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()

      const files = Array.from(e.dataTransfer?.files || [])
      const mdFile = files.find(f => f.name.endsWith('.md') || f.name.endsWith('.markdown'))

      if (mdFile) {
        // Get the file path - in Electron, we can access the path property
        const path = (mdFile as File & { path: string }).path
        if (path) {
          await window.electron.file.openPath(path)
        }
      }
    }

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
    }

    document.addEventListener('drop', handleDrop)
    document.addEventListener('dragover', handleDragOver)

    return () => {
      document.removeEventListener('drop', handleDrop)
      document.removeEventListener('dragover', handleDragOver)
    }
  }, [])

  const handleContentChange = useCallback((newContent: string, wordCount: number, charCount: number) => {
    setContent(newContent)
    setWordCount(wordCount)
    setCharCount(charCount)
    setIsDirty(true)
  }, [])

  const handleSave = useCallback(async () => {
    const currentContent = editorRef.current?.getContent() || content
    if (filePath) {
      const result = await window.electron.file.save(currentContent)
      if (result.success) {
        setIsDirty(false)
      }
    } else {
      const result = await window.electron.file.saveAs(currentContent)
      if (result.success && result.filePath) {
        setFilePath(result.filePath)
        setIsDirty(false)
      }
    }
  }, [content, filePath])

  const commands = [
    { id: 'new', label: 'New File', shortcut: 'Ctrl+N', action: () => window.electron.file.onNew },
    { id: 'open', label: 'Open File', shortcut: 'Ctrl+O', action: () => window.electron.file.open() },
    { id: 'save', label: 'Save', shortcut: 'Ctrl+S', action: handleSave },
    { id: 'saveAs', label: 'Save As...', shortcut: 'Ctrl+Shift+S', action: handleSaveAs },
    { id: 'code', label: 'Toggle Code Editor', shortcut: 'Ctrl+M', action: () => setShowCodeEditor(v => !v) },
    { id: 'theme-light', label: 'Light Theme', action: () => setTheme('light') },
    { id: 'theme-dark', label: 'Dark Theme', action: () => setTheme('dark') },
    { id: 'theme-system', label: 'System Theme', action: () => setTheme('system') },
    ...(isGitRepo ? [
      { id: 'git', label: 'Git Panel', action: () => setShowGitPanel(v => !v) },
    ] : [])
  ]

  // Determine if dark mode is active for code editor
  const isDarkMode = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  // Handle content change from code editor
  const handleCodeEditorChange = useCallback((newContent: string) => {
    setContent(newContent)
    editorRef.current?.setContent(newContent)
    setIsDirty(true)
    // Update word/char counts
    const words = newContent.trim().split(/\s+/).filter(w => w.length > 0).length
    setWordCount(words)
    setCharCount(newContent.length)
  }, [])

  // Handle code editor close
  const handleCodeEditorClose = useCallback(() => {
    setShowCodeEditor(false)
  }, [])

  // Handle validation state change from code editor
  // Track previous validity to detect transitions from invalid to valid
  const wasInvalidRef = useRef(false)
  const handleValidationChange = useCallback((isValid: boolean) => {
    const wasInvalid = wasInvalidRef.current
    wasInvalidRef.current = !isValid
    setIsMarkdownValid(isValid)

    // Only update WYSIWYG editor when transitioning from invalid to valid
    // This prevents cursor reset when typing in WYSIWYG while code editor is open
    if (isValid && wasInvalid && editorRef.current) {
      editorRef.current.setContent(content)
    }
  }, [content])

  return (
    <div className="h-screen flex flex-col bg-background">
      <main className="flex-1 flex overflow-hidden">
        <div className={cn(
          "flex-1 overflow-auto",
          showCodeEditor && "w-1/2"
        )}>
          {isMarkdownValid ? (
            <ProseMirrorEditor
              ref={editorRef}
              initialContent={content}
              onChange={handleContentChange}
              onSave={handleSave}
            />
          ) : (
            <div className="invalid-markdown-placeholder">
              <div className="invalid-markdown-content">
                <div className="invalid-markdown-icon">⚠</div>
                <h2>Markdown Syntax Error</h2>
                <p>The file contains invalid markdown syntax.</p>
                <p>Fix the syntax in the code editor to preview the content.</p>
              </div>
            </div>
          )}
        </div>
        {showCodeEditor && (
          <div className="w-1/2 border-l border-border">
            <CodeEditor
              content={content}
              onChange={handleCodeEditorChange}
              onSave={handleSave}
              onClose={handleCodeEditorClose}
              isDark={isDarkMode}
              onValidationChange={handleValidationChange}
            />
          </div>
        )}
      </main>

      {/* Code Editor FAB */}
      <CodeEditorFab
        isActive={showCodeEditor}
        onToggle={() => setShowCodeEditor(prev => !prev)}
      />

      <StatusBar
        wordCount={wordCount}
        charCount={charCount}
        isDirty={isDirty}
        filePath={filePath}
        isGitRepo={isGitRepo}
        onGitClick={() => setShowGitPanel(true)}
      />

      <CommandPalette
        open={showCommandPalette}
        onOpenChange={setShowCommandPalette}
        commands={commands}
      />

      {showGitPanel && (
        <GitPanel
          open={showGitPanel}
          onOpenChange={setShowGitPanel}
        />
      )}
    </div>
  )
}

export default App
