import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { StatusBar } from './components/StatusBar'
import { CommandPalette } from './components/CommandPalette'
import { GitPanel } from './components/GitPanel'
import { MarkdownPreview } from './components/MarkdownPreview'
import { ConflictBanner } from './components/ConflictBanner'
import { ConflictResolver } from './components/ConflictResolver'
import { Filebar, FolderEntry } from './components/Filebar'
import { TabBar, Tab, createUntitledTab, createFileTab, createBinaryFileTab } from './components/TabBar'
import { FileViewer, FileViewerHandle } from './components/FileViewer'
import { MarkusPanel } from './components/Markus'
import { FileConflict, parseConflicts } from './lib/conflictParser'
import { getFileType, isSupportedFile } from './lib/fileTypes'
import { cn } from './lib/utils'
import { useLayoutMode } from './lib/useLayoutMode'

type Theme = 'light' | 'dark' | 'system'

function App() {
  // Tabs state - replaces single content/filePath
  const [tabs, setTabs] = useState<Tab[]>(() => [createUntitledTab([])])
  const [activeTabId, setActiveTabId] = useState<string | null>(() => tabs[0]?.id || null)

  // Derived state from active tab
  const activeTab = tabs.find(t => t.id === activeTabId) || null
  const content = activeTab?.content || ''
  const filePath = activeTab?.filePath || null
  const isDirty = activeTab?.isDirty || false

  const [wordCount, setWordCount] = useState(0)
  const [charCount, setCharCount] = useState(0)
  const [theme, setTheme] = useState<Theme>('system')
  const [showSplitView, setShowSplitView] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [showGitPanel, setShowGitPanel] = useState(false)
  const [isGitRepo, setIsGitRepo] = useState(false)
  const [behindCount, setBehindCount] = useState(0)
  const [isPulling, setIsPulling] = useState(false)
  const [activeConflict, setActiveConflict] = useState<FileConflict | null>(null)
  const [showFilebar, setShowFilebar] = useState(false)
  const [folders, setFolders] = useState<FolderEntry[]>([])
  const [filebarWidth, setFilebarWidth] = useState(280)
  const [isResizing, setIsResizing] = useState(false)
  const [showMarkusPanel, setShowMarkusPanel] = useState(false)
  const [markusPanelWidth, setMarkusPanelWidth] = useState(() =>
    Math.floor(window.innerWidth * 0.25)
  )
  const [isResizingMarkus, setIsResizingMarkus] = useState(false)
  const [filebarHeight, setFilebarHeight] = useState(200)
  const [markusPanelHeight, setMarkusPanelHeight] = useState(() =>
    Math.floor(window.innerHeight * 0.25)
  )
  const { isVertical } = useLayoutMode()
  const editorRef = useRef<FileViewerHandle>(null)

  // Per-mode dimension helpers — vertical uses height, horizontal uses width
  const filebarDimension = isVertical ? filebarHeight : filebarWidth
  const setFilebarDimension = isVertical ? setFilebarHeight : setFilebarWidth
  const markusDimension = isVertical ? markusPanelHeight : markusPanelWidth
  const setMarkusDimension = isVertical ? setMarkusPanelHeight : setMarkusPanelWidth

  // Update tab content helper
  const updateTabContent = useCallback((tabId: string, newContent: string, markDirty = true) => {
    setTabs(prev => prev.map(tab =>
      tab.id === tabId
        ? { ...tab, content: newContent, isDirty: markDirty ? newContent !== tab.savedContent : tab.isDirty }
        : tab
    ))
  }, [])

  // Mark tab as saved
  // contentThatWasSaved should be passed to ensure savedContent matches what was written to disk
  const markTabSaved = useCallback((tabId: string, contentThatWasSaved?: string, newFilePath?: string) => {
    setTabs(prev => prev.map(tab => {
      if (tab.id !== tabId) return tab

      // Use the content that was actually saved, or fall back to tab.content
      const savedContent = contentThatWasSaved ?? tab.content
      const updatedTab: Tab = {
        ...tab,
        content: savedContent,  // Sync content with what was saved
        savedContent,
        isDirty: false
      }

      if (newFilePath) {
        updatedTab.filePath = newFilePath
        updatedTab.title = newFilePath.split('/').pop() || newFilePath
        updatedTab.id = newFilePath
      }

      return updatedTab
    }))

    // Update activeTabId if it changed
    if (newFilePath && tabId !== newFilePath) {
      setActiveTabId(newFilePath)
    }
  }, [])

  // Create new tab
  const createNewTab = useCallback(() => {
    const newTab = createUntitledTab(tabs)
    setTabs(prev => [...prev, newTab])
    setActiveTabId(newTab.id)
    editorRef.current?.setContent('')
  }, [tabs])

  // Open text file in new tab or switch to existing
  const openFileInTab = useCallback((openFilePath: string, fileContent: string) => {
    // Check if file is already open
    const existingTab = tabs.find(t => t.filePath === openFilePath)
    if (existingTab) {
      setActiveTabId(existingTab.id)
      // Only set content for markdown files (ProseMirror needs this)
      if (existingTab.fileType === 'markdown') {
        editorRef.current?.setContent(existingTab.content)
      }
      return
    }

    // Create new tab for file
    const newTab = createFileTab(openFilePath, fileContent)
    setTabs(prev => [...prev, newTab])
    setActiveTabId(newTab.id)
    // Only set content for markdown files
    if (newTab.fileType === 'markdown') {
      editorRef.current?.setContent(fileContent)
    }
  }, [tabs])

  // Open binary file in new tab or switch to existing
  const openBinaryFileInTab = useCallback((openFilePath: string, binaryData: string) => {
    // Check if file is already open
    const existingTab = tabs.find(t => t.filePath === openFilePath)
    if (existingTab) {
      setActiveTabId(existingTab.id)
      return
    }

    // Create new tab for binary file
    const newTab = createBinaryFileTab(openFilePath, binaryData)
    setTabs(prev => [...prev, newTab])
    setActiveTabId(newTab.id)
  }, [tabs])

  // Close tab
  const closeTab = useCallback(async (tabId: string) => {
    const tabToClose = tabs.find(t => t.id === tabId)
    if (!tabToClose) return

    // Ask to save if dirty
    if (tabToClose.isDirty) {
      const result = await window.electron.dialog.showMessage({
        type: 'question',
        title: 'Unsaved Changes',
        message: `Do you want to save changes to "${tabToClose.title}"?`,
        buttons: ['Save', "Don't Save", 'Cancel']
      })

      if (result.response === 2) return // Cancel
      if (result.response === 0) {
        // Save first
        if (tabToClose.filePath) {
          await window.electron.file.save(tabToClose.content)
        } else {
          const saveResult = await window.electron.file.saveAs(tabToClose.content)
          if (!saveResult.success) return
        }
      }
    }

    // Remove tab
    setTabs(prev => {
      const remaining = prev.filter(t => t.id !== tabId)

      // If closing active tab, switch to another
      if (tabId === activeTabId && remaining.length > 0) {
        const currentIndex = prev.findIndex(t => t.id === tabId)
        const newIndex = Math.min(currentIndex, remaining.length - 1)
        const nextTab = remaining[newIndex]
        setActiveTabId(nextTab.id)
        // Only set content for markdown files
        if (nextTab.fileType === 'markdown') {
          editorRef.current?.setContent(nextTab.content)
        }
      }

      // If no tabs left, create new untitled
      if (remaining.length === 0) {
        const newTab = createUntitledTab([])
        setActiveTabId(newTab.id)
        editorRef.current?.setContent('')
        return [newTab]
      }

      return remaining
    })
  }, [tabs, activeTabId])

  // Switch to tab
  const switchToTab = useCallback((tabId: string) => {
    const tab = tabs.find(t => t.id === tabId)
    if (tab) {
      setActiveTabId(tabId)
      // Only set content for markdown files (ProseMirror needs this)
      if (tab.fileType === 'markdown') {
        editorRef.current?.setContent(tab.content)
      }
    }
  }, [tabs])

  // Apply theme
  useEffect(() => {
    const root = document.documentElement
    const applyTheme = (t: Theme) => {
      if (t === 'system') {
        const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches
        root.classList.toggle('dark', isDarkMode)
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

  // Load saved theme and filebar state
  useEffect(() => {
    const loadState = async () => {
      // Check if the app was launched by opening a file (double-click, command-line).
      // If so, skip restoring panel visibility — start with a clean editing view.
      const launchedWithFile = await window.electron.store.get('_launchedWithFile')

      window.electron.store.get('theme').then((savedTheme: unknown) => {
        if (savedTheme) setTheme(savedTheme as Theme)
      })

      // Only restore panel visibility when launched normally (not via file open)
      if (!launchedWithFile) {
        window.electron.store.get('showFilebar').then((saved: unknown) => {
          if (saved !== undefined && saved !== null) setShowFilebar(saved as boolean)
        })
        window.electron.store.get('showMarkusPanel').then((saved: unknown) => {
          if (saved !== undefined && saved !== null) setShowMarkusPanel(saved as boolean)
        })
      }

      window.electron.store.get('filebarFolders').then((saved: unknown) => {
        if (saved && Array.isArray(saved)) {
          setFolders(saved as FolderEntry[])
        }
      })
      window.electron.store.get('filebarWidth').then((saved: unknown) => {
        if (typeof saved === 'number') setFilebarWidth(saved)
      })
      window.electron.store.get('filebarHeight').then((saved: unknown) => {
        if (typeof saved === 'number') setFilebarHeight(saved)
      })
      window.electron.store.get('markusPanelWidth').then((saved: unknown) => {
        if (typeof saved === 'number') setMarkusPanelWidth(saved)
      })
      window.electron.store.get('markusPanelHeight').then((saved: unknown) => {
        if (typeof saved === 'number') setMarkusPanelHeight(saved)
      })
    }
    loadState()
  }, [])

  // Save theme when changed
  useEffect(() => {
    window.electron.store.set('theme', theme)
  }, [theme])

  // Save filebar state when changed
  useEffect(() => {
    window.electron.store.set('showFilebar', showFilebar)
  }, [showFilebar])

  // Save Markus panel state when changed
  useEffect(() => {
    window.electron.store.set('showMarkusPanel', showMarkusPanel)
  }, [showMarkusPanel])

  useEffect(() => {
    window.electron.store.set('filebarFolders', folders)
  }, [folders])

  // Save panel dimensions when changed
  useEffect(() => {
    window.electron.store.set('filebarWidth', filebarWidth)
  }, [filebarWidth])

  useEffect(() => {
    window.electron.store.set('filebarHeight', filebarHeight)
  }, [filebarHeight])

  useEffect(() => {
    window.electron.store.set('markusPanelWidth', markusPanelWidth)
  }, [markusPanelWidth])

  useEffect(() => {
    window.electron.store.set('markusPanelHeight', markusPanelHeight)
  }, [markusPanelHeight])

  /**
   * Adds a folder to the filebar, checking if it's inside a git repo.
   * If it's inside a git repo, adds the git root instead.
   */
  const addFolderToFilebar = useCallback(async (folderPath: string) => {
    // Check if already open
    if (folders.some(f => f.path === folderPath)) {
      return
    }

    // Check if it's a git repo
    const isGitRepo = await window.electron.git.isRepoAtPath(folderPath)

    if (isGitRepo) {
      setFolders(prev => [...prev, { path: folderPath, isGitRepo: true }])
      return
    }

    // Check if it's inside a git repo
    const gitRootResult = await window.electron.explorer.getGitRoot(folderPath)
    if (gitRootResult.success && gitRootResult.gitRoot) {
      // Check if git root is already open
      if (!folders.some(f => f.path === gitRootResult.gitRoot)) {
        setFolders(prev => [...prev, { path: gitRootResult.gitRoot!, isGitRepo: true }])
        return
      }
    }

    // Add the folder as-is
    setFolders(prev => [...prev, { path: folderPath, isGitRepo: false }])
  }, [folders])

  // Check if in git repo when file path changes and auto-add to filebar
  useEffect(() => {
    if (filePath) {
      window.electron.git.isRepo().then(setIsGitRepo)

      // Auto-add the git root folder to filebar if not already there
      window.electron.explorer.getGitRoot(filePath).then((result: { success: boolean; gitRoot?: string | null }) => {
        if (result.success && result.gitRoot) {
          if (!folders.some(f => f.path === result.gitRoot)) {
            setFolders(prev => [...prev, { path: result.gitRoot!, isGitRepo: true }])
          }
        }
      })
    } else {
      setIsGitRepo(false)
      setBehindCount(0)
    }
  }, [filePath, folders])

  /**
   * Fetches from remote and updates behind count.
   */
  const checkForUpdates = useCallback(async () => {
    if (!isGitRepo || !filePath) return

    try {
      await window.electron.git.fetch()
      const status = await window.electron.git.status()
      // Handle null response when no file is open
      if (status) {
        setBehindCount(status.behind)
      }
    } catch {
      // Silently ignore fetch errors
    }
  }, [isGitRepo, filePath])

  // Check for updates when file opens and periodically
  useEffect(() => {
    if (!isGitRepo || !filePath) return

    checkForUpdates()
    const interval = setInterval(checkForUpdates, 2 * 60 * 1000)
    return () => clearInterval(interval)
  }, [isGitRepo, filePath, checkForUpdates])

  /**
   * Handles pulling updates with conflict detection.
   */
  const handlePull = useCallback(async () => {
    setIsPulling(true)

    try {
      const result = await window.electron.git.pullWithConflictDetection()

      if (!result.success) {
        await window.electron.dialog.showMessage({
          type: 'error',
          title: 'Pull Failed',
          message: result.error || 'Failed to pull updates',
          buttons: ['OK']
        })
        return
      }

      if (result.hasConflicts && result.content) {
        const conflict = parseConflicts(result.content, filePath || '')
        if (conflict.sections.length > 0) {
          setActiveConflict(conflict)
        } else {
          await window.electron.dialog.showMessage({
            type: 'warning',
            title: 'Merge Conflict',
            message: 'There was a merge conflict but it could not be parsed. Please resolve it manually.',
            buttons: ['OK']
          })
        }
      } else if (result.content && activeTabId) {
        updateTabContent(activeTabId, result.content, false)
        editorRef.current?.setContent(result.content)
        markTabSaved(activeTabId, result.content)
        setBehindCount(0)
      }
    } catch (err) {
      await window.electron.dialog.showMessage({
        type: 'error',
        title: 'Error',
        message: String(err),
        buttons: ['OK']
      })
    } finally {
      setIsPulling(false)
    }
  }, [filePath, activeTabId, updateTabContent, markTabSaved])

  /**
   * Called when user finishes resolving conflicts.
   */
  const handleConflictResolved = useCallback(async (resolvedContent: string) => {
    try {
      const result = await window.electron.git.writeResolution(resolvedContent)

      if (result.success && activeTabId) {
        updateTabContent(activeTabId, resolvedContent, false)
        editorRef.current?.setContent(resolvedContent)
        markTabSaved(activeTabId, resolvedContent)
        setActiveConflict(null)
        setBehindCount(0)

        const commitResult = await window.electron.dialog.showMessage({
          type: 'question',
          title: 'Merge Complete',
          message: 'Conflicts resolved successfully. Would you like to commit the merge now?',
          buttons: ['Commit', 'Later']
        })

        if (commitResult.response === 0) {
          setShowGitPanel(true)
        }
      } else {
        await window.electron.dialog.showMessage({
          type: 'error',
          title: 'Error',
          message: result.error || 'Failed to save resolved content',
          buttons: ['OK']
        })
      }
    } catch (err) {
      await window.electron.dialog.showMessage({
        type: 'error',
        title: 'Error',
        message: String(err),
        buttons: ['OK']
      })
    }
  }, [activeTabId, updateTabContent, markTabSaved])

  /**
   * Called when user cancels conflict resolution.
   */
  const handleConflictCancel = useCallback(async () => {
    const result = await window.electron.dialog.showMessage({
      type: 'question',
      title: 'Cancel Merge',
      message: 'Are you sure you want to cancel? This will abort the merge and restore your previous version.',
      buttons: ['Cancel Merge', 'Continue Resolving']
    })

    if (result.response === 0) {
      try {
        await window.electron.git.abortMerge()
        const fileResult = await window.electron.git.readCurrentFile()
        if (fileResult.success && fileResult.content && activeTabId) {
          updateTabContent(activeTabId, fileResult.content, false)
          editorRef.current?.setContent(fileResult.content)
        }
        setActiveConflict(null)
        checkForUpdates()
      } catch (err) {
        await window.electron.dialog.showMessage({
          type: 'error',
          title: 'Error',
          message: String(err),
          buttons: ['OK']
        })
      }
    }
  }, [checkForUpdates, activeTabId, updateTabContent])

  // Handle file operations from main process
  useEffect(() => {
    const unsubNew = window.electron.file.onNew(() => {
      createNewTab()
    })

    const unsubOpened = window.electron.file.onOpened((data: { content: string; filePath: string }) => {
      openFileInTab(data.filePath, data.content)
    })

    const unsubBinaryOpened = window.electron.file.onBinaryOpened((data: { data: string; filePath: string }) => {
      openBinaryFileInTab(data.filePath, data.data)
    })

    const unsubRequestContent = window.electron.file.onRequestContent(async () => {
      const currentContent = editorRef.current?.getContent() || content
      const result = await window.electron.file.save(currentContent)
      if (result.success && activeTabId) {
        markTabSaved(activeTabId, currentContent)
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

      if (result.response === 0 && activeTabId) {
        updateTabContent(activeTabId, externalContent, false)
        // Only set content for markdown files
        if (activeTab?.fileType === 'markdown') {
          editorRef.current?.setContent(externalContent)
        }
        markTabSaved(activeTabId, externalContent)
      }
    })

    return () => {
      unsubNew()
      unsubOpened()
      unsubBinaryOpened()
      unsubRequestContent()
      unsubExternalChange()
    }
  }, [content, activeTabId, activeTab?.fileType, createNewTab, openFileInTab, openBinaryFileInTab, updateTabContent, markTabSaved])

  // Handle menu events
  useEffect(() => {
    const unsubTheme = window.electron.menu.onToggleTheme(setTheme)
    const unsubSplit = window.electron.menu.onToggleSplitView(() => setShowSplitView(v => !v))
    const unsubPalette = window.electron.menu.onOpenCommandPalette(() => setShowCommandPalette(true))
    const unsubExplorer = window.electron.menu.onToggleExplorer(() => setShowFilebar(v => !v))
    const unsubMarkus = window.electron.markus.onToggleMarkus(() => setShowMarkusPanel(v => !v))
    const unsubOpenFolder = window.electron.explorer.onOpenFolder((data: { path: string }) => {
      addFolderToFilebar(data.path)
      setShowFilebar(true)
    })

    return () => {
      unsubTheme()
      unsubSplit()
      unsubPalette()
      unsubExplorer()
      unsubMarkus()
      unsubOpenFolder()
    }
  }, [addFolderToFilebar])

  // Handle Save As
  const handleSaveAs = useCallback(async () => {
    const currentContent = editorRef.current?.getContent() || content
    const result = await window.electron.file.saveAs(currentContent)
    if (result.success && result.filePath && activeTabId) {
      markTabSaved(activeTabId, currentContent, result.filePath)
    }
  }, [content, activeTabId, markTabSaved])

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+P - Command palette
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        e.preventDefault()
        setShowCommandPalette(true)
      }
      // Ctrl+Shift+S - Save As
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'S') {
        e.preventDefault()
        handleSaveAs()
      }
      // Ctrl+B - Toggle filebar
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault()
        setShowFilebar(v => !v)
      }
      // Ctrl+T - New tab
      if ((e.metaKey || e.ctrlKey) && e.key === 't') {
        e.preventDefault()
        createNewTab()
      }
      // Ctrl+W - Close tab
      if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
        e.preventDefault()
        if (activeTabId) {
          closeTab(activeTabId)
        }
      }
      // Ctrl+M - Toggle Markus panel
      if ((e.metaKey || e.ctrlKey) && e.key === 'm') {
        e.preventDefault()
        setShowMarkusPanel(v => !v)
      }
      // Ctrl+N - New window (handled by main process)
      // We don't prevent default here, let it go to the main process
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSaveAs, createNewTab, closeTab, activeTabId])

  // Handle opening folder from filebar
  const handleOpenFolder = useCallback(async () => {
    const result = await window.electron.explorer.openFolder()
    if (result.success && result.path) {
      addFolderToFilebar(result.path)
    }
  }, [addFolderToFilebar])

  // Handle opening file from explorer
  const handleOpenFileFromExplorer = useCallback(async (openFilePath: string) => {
    await window.electron.file.openPath(openFilePath)
  }, [])

  // Handle drag and drop
  useEffect(() => {
    const handleDrop = async (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()

      const items = Array.from(e.dataTransfer?.files || [])
      if (items.length === 0) return

      const firstItem = items[0] as File & { path: string }
      const droppedPath = firstItem.path
      if (!droppedPath) return

      const fileType = getFileType(droppedPath)
      const isSupported = isSupportedFile(fileType)

      if (isSupported) {
        // Open supported files in the editor
        await window.electron.file.openPath(droppedPath)
      } else {
        // For unsupported files or folders, try to add to filebar
        const gitResult = await window.electron.explorer.getGitRoot(droppedPath)
        if (gitResult.success && gitResult.gitRoot) {
          addFolderToFilebar(gitResult.gitRoot)
          setShowFilebar(true)
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
  }, [addFolderToFilebar])

  const handleContentChange = useCallback((newContent: string, newWordCount: number, newCharCount: number) => {
    if (activeTabId) {
      updateTabContent(activeTabId, newContent)
    }
    setWordCount(newWordCount)
    setCharCount(newCharCount)
  }, [activeTabId, updateTabContent])

  const handleSave = useCallback(async () => {
    const currentContent = editorRef.current?.getContent() || content
    if (filePath) {
      const result = await window.electron.file.save(currentContent)
      if (result.success && activeTabId) {
        markTabSaved(activeTabId, currentContent)
      }
    } else {
      const result = await window.electron.file.saveAs(currentContent)
      if (result.success && result.filePath && activeTabId) {
        markTabSaved(activeTabId, currentContent, result.filePath)
      }
    }
  }, [content, filePath, activeTabId, markTabSaved])

  // Memoized arrays for Markus panel
  const workspaceFolders = useMemo(() => folders.map(f => f.path), [folders])
  const openFilePaths = useMemo(() =>
    tabs.filter(t => t.filePath).map(t => t.filePath!),
    [tabs]
  )

  const commands = [
    { id: 'newTab', label: 'New Tab', shortcut: 'Ctrl+T', action: createNewTab },
    { id: 'closeTab', label: 'Close Tab', shortcut: 'Ctrl+W', action: () => activeTabId && closeTab(activeTabId) },
    { id: 'open', label: 'Open File', shortcut: 'Ctrl+O', action: () => window.electron.file.open() },
    { id: 'openFolder', label: 'Open Folder', action: handleOpenFolder },
    { id: 'save', label: 'Save', shortcut: 'Ctrl+S', action: handleSave },
    { id: 'saveAs', label: 'Save As...', shortcut: 'Ctrl+Shift+S', action: handleSaveAs },
    { id: 'filebar', label: 'Toggle Filebar', shortcut: 'Ctrl+B', action: () => setShowFilebar(v => !v) },
    { id: 'markus', label: 'Toggle Markus', shortcut: 'Ctrl+M', action: () => setShowMarkusPanel(v => !v) },
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
      {/* Warning banner when file is behind remote */}
      {isGitRepo && (
        <ConflictBanner
          behind={behindCount}
          onPull={handlePull}
          isPulling={isPulling}
        />
      )}

      {/* Tab bar */}
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onTabClick={switchToTab}
        onTabClose={closeTab}
        onNewTab={createNewTab}
        showFilebar={showFilebar}
        onToggleFilebar={() => setShowFilebar(v => !v)}
        showMarkusPanel={showMarkusPanel}
        onToggleMarkusPanel={() => setShowMarkusPanel(v => !v)}
        isVertical={isVertical}
      />

      <main className={cn("flex-1 flex overflow-hidden", isVertical && "flex-col")}>
        {/* Filebar with multiple folder panels */}
        {showFilebar && (
          <>
            <div
              className={cn(
                "flex flex-col flex-shrink-0 overflow-hidden",
                isVertical ? "border-b border-border" : "border-r border-border"
              )}
              style={isVertical ? { height: filebarDimension } : { width: filebarDimension }}
            >
              <Filebar
                folders={folders}
                onFoldersChange={setFolders}
                onOpenFile={handleOpenFileFromExplorer}
                activeFilePath={filePath}
                onConflict={(conflictContent) => {
                  const conflict = parseConflicts(conflictContent, filePath || '')
                  if (conflict.sections.length > 0) {
                    setActiveConflict(conflict)
                  }
                }}
              />
            </div>
            {/* Resize handle */}
            <div
              className={cn(
                "hover:bg-primary/50 active:bg-primary transition-colors",
                isVertical ? "h-1 cursor-row-resize" : "w-1 cursor-col-resize",
                isResizing && "bg-primary"
              )}
              onMouseDown={(e) => {
                e.preventDefault()
                setIsResizing(true)
                const startPos = isVertical ? e.clientY : e.clientX
                const startSize = filebarDimension

                const handleMouseMove = (e: MouseEvent) => {
                  const currentPos = isVertical ? e.clientY : e.clientX
                  const [min, max] = isVertical ? [100, 400] : [150, 500]
                  const newSize = Math.max(min, Math.min(max, startSize + currentPos - startPos))
                  setFilebarDimension(newSize)
                }

                const handleMouseUp = () => {
                  setIsResizing(false)
                  document.removeEventListener('mousemove', handleMouseMove)
                  document.removeEventListener('mouseup', handleMouseUp)
                }

                document.addEventListener('mousemove', handleMouseMove)
                document.addEventListener('mouseup', handleMouseUp)
              }}
            />
          </>
        )}

        {/* Editor/Viewer - split view only for markdown files */}
        {activeTab && (
          <>
            <div className={cn(
              "flex-1 flex flex-col overflow-hidden",
              showSplitView && activeTab.fileType === 'markdown' && "w-1/2"
            )}>
              <div className="flex-1 overflow-auto">
                <FileViewer
                  ref={editorRef}
                  tab={activeTab}
                  onContentChange={handleContentChange}
                  onSave={handleSave}
                />
              </div>
            </div>
            {/* Markdown preview split view (only for markdown files) */}
            {showSplitView && activeTab.fileType === 'markdown' && (
              <div className="w-1/2 border-l border-border overflow-auto">
                <MarkdownPreview content={content} />
              </div>
            )}
          </>
        )}

        {/* Markus AI panel */}
        {showMarkusPanel && (
          <>
            {/* Resize handle */}
            <div
              className={cn(
                "hover:bg-primary/50 active:bg-primary transition-colors",
                isVertical ? "h-1 cursor-row-resize" : "w-1 cursor-col-resize",
                isResizingMarkus && "bg-primary"
              )}
              onMouseDown={(e) => {
                e.preventDefault()
                setIsResizingMarkus(true)
                const startPos = isVertical ? e.clientY : e.clientX
                const startSize = markusDimension

                const handleMouseMove = (e: MouseEvent) => {
                  // Markus panel resizes from the top/left edge, so subtract delta
                  const currentPos = isVertical ? e.clientY : e.clientX
                  const [min, max] = isVertical ? [150, 500] : [250, 600]
                  const newSize = Math.max(min, Math.min(max, startSize - (currentPos - startPos)))
                  setMarkusDimension(newSize)
                }

                const handleMouseUp = () => {
                  setIsResizingMarkus(false)
                  document.removeEventListener('mousemove', handleMouseMove)
                  document.removeEventListener('mouseup', handleMouseUp)
                }

                document.addEventListener('mousemove', handleMouseMove)
                document.addEventListener('mouseup', handleMouseUp)
              }}
            />
            <div
              className={cn(
                "flex flex-col flex-shrink-0 overflow-hidden",
                isVertical ? "border-t border-border" : "border-l border-border"
              )}
              style={isVertical ? { height: markusDimension } : { width: markusDimension }}
            >
              <MarkusPanel
                workspaceFolders={workspaceFolders}
                openFiles={openFilePaths}
              />
            </div>
          </>
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

      {/* Conflict resolver modal */}
      {activeConflict && (
        <ConflictResolver
          conflict={activeConflict}
          onResolve={handleConflictResolved}
          onCancel={handleConflictCancel}
        />
      )}
    </div>
  )
}

export default App
