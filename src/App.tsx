import { useState, useEffect, useCallback, useRef } from 'react'
import { ProseMirrorEditor, ProseMirrorEditorHandle } from './editor/ProseMirrorEditor'
import { StatusBar } from './components/StatusBar'
import { CommandPalette } from './components/CommandPalette'
import { GitPanel } from './components/GitPanel'
import { MarkdownPreview } from './components/MarkdownPreview'
import { cn } from './lib/utils'

type Theme = 'light' | 'dark' | 'system'

function App() {
  const [content, setContent] = useState('')
  const [filePath, setFilePath] = useState<string | null>(null)
  const [wordCount, setWordCount] = useState(0)
  const [charCount, setCharCount] = useState(0)
  const [isDirty, setIsDirty] = useState(false)
  const [theme, setTheme] = useState<Theme>('system')
  const [showSplitView, setShowSplitView] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [showGitPanel, setShowGitPanel] = useState(false)
  const [isGitRepo, setIsGitRepo] = useState(false)
  const editorRef = useRef<ProseMirrorEditorHandle>(null)

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
      editorRef.current?.setContent('')
    })

    const unsubOpened = window.electron.file.onOpened((data: { content: string; filePath: string }) => {
      const { content: fileContent, filePath: path } = data
      setContent(fileContent)
      setFilePath(path)
      setIsDirty(false)
      editorRef.current?.setContent(fileContent)
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
  }, [content])

  // Handle menu events
  useEffect(() => {
    const unsubTheme = window.electron.menu.onToggleTheme(setTheme)
    const unsubSplit = window.electron.menu.onToggleSplitView(() => setShowSplitView(v => !v))
    const unsubPalette = window.electron.menu.onOpenCommandPalette(() => setShowCommandPalette(true))

    return () => {
      unsubTheme()
      unsubSplit()
      unsubPalette()
    }
  }, [])

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        e.preventDefault()
        setShowCommandPalette(true)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

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
    { id: 'saveAs', label: 'Save As...', shortcut: 'Ctrl+Shift+S', action: async () => {
      const currentContent = editorRef.current?.getContent() || content
      await window.electron.file.saveAs(currentContent)
    }},
    { id: 'split', label: 'Toggle Split View', shortcut: 'Ctrl+\\', action: () => setShowSplitView(v => !v) },
    { id: 'theme-light', label: 'Light Theme', action: () => setTheme('light') },
    { id: 'theme-dark', label: 'Dark Theme', action: () => setTheme('dark') },
    { id: 'theme-system', label: 'System Theme', action: () => setTheme('system') },
    ...(isGitRepo ? [
      { id: 'git', label: 'Git Panel', action: () => setShowGitPanel(v => !v) },
    ] : [])
  ]

  return (
    <div className="h-screen flex flex-col bg-background">
      <main className="flex-1 flex overflow-hidden">
        <div className={cn("flex-1 overflow-auto", showSplitView && "w-1/2")}>
          <ProseMirrorEditor
            ref={editorRef}
            initialContent={content}
            onChange={handleContentChange}
            onSave={handleSave}
          />
        </div>
        {showSplitView && (
          <div className="w-1/2 border-l border-border overflow-auto">
            <MarkdownPreview content={content} />
          </div>
        )}
      </main>

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
