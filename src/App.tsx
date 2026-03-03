import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { StatusBar } from './components/StatusBar'
import { CommandPalette } from './components/CommandPalette'
import { GitPanel } from './components/GitPanel'
import { CodeEditor } from './components/FileViewer/CodeEditor'
import { ConflictBanner } from './components/ConflictBanner'
import { ConflictResolver } from './components/ConflictResolver'
import { Workspace, FolderEntry } from './components/Workspace'
import { TabBar, Tab, createUntitledTab, createFileTab, createBinaryFileTab } from './components/TabBar'
import { FileViewer, FileViewerHandle } from './components/FileViewer'
import { AgentWidget } from './components/Markus'
import { QuakeTerminal } from './components/Terminal'
import { SettingsView } from './components/SettingsView/SettingsView'
import { FileConflict, parseConflicts } from './lib/conflictParser'
import { getFileType, isSupportedFile } from './lib/fileTypes'
import { UrlInputDialog } from './components/UrlInputDialog'
import { extractDroppedUrl } from './lib/urlUtils'
import { cn } from './lib/utils'
import { useLayoutMode } from './lib/useLayoutMode'
import { useCommentAuthor } from './lib/useCommentAuthor'
import { onCommentToAgent } from './lib/commentAgentBridge'

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
  const [showEdits, setShowEdits] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [showGitPanel, setShowGitPanel] = useState(false)
  const [isGitRepo, setIsGitRepo] = useState(false)
  const [behindCount, setBehindCount] = useState(0)
  const [isPulling, setIsPulling] = useState(false)
  const [activeConflict, setActiveConflict] = useState<FileConflict | null>(null)
  // Default to visible — panels should only be hidden when launched with a file
  // (see the launchedWithFile check in loadState below)
  const [showWorkspace, setShowWorkspace] = useState(true)
  const [folders, setFolders] = useState<FolderEntry[]>([])
  const [workspaceWidth, setWorkspaceWidth] = useState(280)
  const [isResizing, setIsResizing] = useState(false)
  // Default to visible — same rationale as showWorkspace above
  const [showAgent, setShowAgent] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [showUrlImport, setShowUrlImport] = useState(false)
  const [showTerminal, setShowTerminal] = useState(false)
  // Default to 50% of viewport height
  const [terminalHeight, setTerminalHeight] = useState(() => Math.floor(window.innerHeight * 0.5))
  // 0 = fully transparent, 100 = fully opaque. Default 75 (25% transparent)
  const [terminalOpacity, setTerminalOpacity] = useState(75)
  const [agentWidth, setAgentWidth] = useState(() =>
    Math.floor(window.innerWidth * 0.25)
  )
  const [isResizingAgent, setIsResizingAgent] = useState(false)
  const [workspaceHeight, setWorkspaceHeight] = useState(200)
  const [agentHeight, setAgentHeight] = useState(() =>
    Math.floor(window.innerHeight * 0.25)
  )
  const { isVertical } = useLayoutMode()
  const { author: commentAuthor } = useCommentAuthor()
  const editorRef = useRef<FileViewerHandle>(null)
  const activeTabIdRef = useRef(activeTabId)
  activeTabIdRef.current = activeTabId

  // Timer for debounced code editor → ProseMirror sync in split view
  const splitSyncTimerRef = useRef<ReturnType<typeof setTimeout>>()

  // Per-mode dimension helpers — vertical uses height, horizontal uses width
  const workspaceDimension = isVertical ? workspaceHeight : workspaceWidth
  const setWorkspaceDimension = isVertical ? setWorkspaceHeight : setWorkspaceWidth
  const agentDimension = isVertical ? agentHeight : agentWidth
  const setAgentDimension = isVertical ? setAgentHeight : setAgentWidth

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
      // Already the active tab — editor already has the content, no need
      // to call setContent (which would reset all ProseMirror plugin states)
      if (existingTab.id === activeTabIdRef.current) return

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

  // Forward renderer-side errors to the centralized log file so they
  // show up alongside main process logs in the same session file
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      window.electron.logger.log('error', `[window.onerror] ${event.message} at ${event.filename}:${event.lineno}`)
    }
    const handleRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason instanceof Error ? event.reason.stack || event.reason.message : String(event.reason)
      window.electron.logger.log('error', `[unhandledrejection] ${reason}`)
    }
    window.addEventListener('error', handleError)
    window.addEventListener('unhandledrejection', handleRejection)
    return () => {
      window.removeEventListener('error', handleError)
      window.removeEventListener('unhandledrejection', handleRejection)
    }
  }, [])

  // Load saved theme and workspace state
  useEffect(() => {
    const loadState = async () => {
      // Check if the app was launched by opening a file (double-click, command-line).
      // If so, skip restoring panel visibility — start with a clean editing view.
      const launchedWithFile = await window.electron.store.get('_launchedWithFile')

      window.electron.store.get('theme').then((savedTheme: unknown) => {
        if (savedTheme) setTheme(savedTheme as Theme)
      })

      // When launched by opening a file (double-click, CLI), hide panels for
      // a clean editing view.  Normal launch keeps the useState defaults (true).
      if (launchedWithFile) {
        setShowWorkspace(false)
        setShowAgent(false)
      }

      window.electron.store.get('workspaceFolders').then((saved: unknown) => {
        if (saved && Array.isArray(saved)) {
          setFolders(saved as FolderEntry[])
        }
      })
      window.electron.store.get('workspaceWidth').then((saved: unknown) => {
        if (typeof saved === 'number') setWorkspaceWidth(saved)
      })
      window.electron.store.get('workspaceHeight').then((saved: unknown) => {
        if (typeof saved === 'number') setWorkspaceHeight(saved)
      })
      window.electron.store.get('agentWidth').then((saved: unknown) => {
        if (typeof saved === 'number') setAgentWidth(saved)
      })
      window.electron.store.get('agentHeight').then((saved: unknown) => {
        if (typeof saved === 'number') setAgentHeight(saved)
      })
      window.electron.store.get('terminalHeight').then((saved: unknown) => {
        if (typeof saved === 'number') setTerminalHeight(saved)
      })
      window.electron.store.get('terminalOpacity').then((saved: unknown) => {
        if (typeof saved === 'number') setTerminalOpacity(saved)
      })
    }
    loadState()
  }, [])

  // Save theme when changed
  useEffect(() => {
    window.electron.store.set('theme', theme)
  }, [theme])

  // Save workspace state when changed
  useEffect(() => {
    window.electron.store.set('showWorkspace', showWorkspace)
  }, [showWorkspace])

  // Save agent panel state when changed
  useEffect(() => {
    window.electron.store.set('showAgent', showAgent)
  }, [showAgent])

  useEffect(() => {
    window.electron.store.set('workspaceFolders', folders)
  }, [folders])

  // Save panel dimensions when changed
  useEffect(() => {
    window.electron.store.set('workspaceWidth', workspaceWidth)
  }, [workspaceWidth])

  useEffect(() => {
    window.electron.store.set('workspaceHeight', workspaceHeight)
  }, [workspaceHeight])

  useEffect(() => {
    window.electron.store.set('agentWidth', agentWidth)
  }, [agentWidth])

  useEffect(() => {
    window.electron.store.set('agentHeight', agentHeight)
  }, [agentHeight])

  useEffect(() => {
    window.electron.store.set('terminalHeight', terminalHeight)
  }, [terminalHeight])

  useEffect(() => {
    window.electron.store.set('terminalOpacity', terminalOpacity)
  }, [terminalOpacity])


  /**
   * Adds a folder to the workspace, checking if it's inside a git repo.
   * If it's inside a git repo, adds the git root instead.
   */
  const addFolderToWorkspace = useCallback(async (folderPath: string) => {
    // Check if already open
    if (folders.some(f => f.path === folderPath)) {
      return
    }

    // Adds the resolved path to the recent folders list in the store
    const trackRecentFolder = async (resolvedPath: string) => {
      const recent = ((await window.electron.store.get('recentFolders')) as string[] | null) ?? []
      const filtered = recent.filter(f => f !== resolvedPath)
      const updated = [resolvedPath, ...filtered].slice(0, 5)
      window.electron.store.set('recentFolders', updated)
    }

    // Check if it's a git repo
    const isGitRepo = await window.electron.git.isRepoAtPath(folderPath)

    if (isGitRepo) {
      setFolders(prev => [...prev, { path: folderPath, isGitRepo: true }])
      trackRecentFolder(folderPath)
      return
    }

    // Check if it's inside a git repo
    const gitRootResult = await window.electron.explorer.getGitRoot(folderPath)
    if (gitRootResult.success && gitRootResult.gitRoot) {
      // Check if git root is already open
      if (!folders.some(f => f.path === gitRootResult.gitRoot)) {
        setFolders(prev => [...prev, { path: gitRootResult.gitRoot!, isGitRepo: true }])
        trackRecentFolder(gitRootResult.gitRoot)
        return
      }
    }

    // Add the folder as-is
    setFolders(prev => [...prev, { path: folderPath, isGitRepo: false }])
    trackRecentFolder(folderPath)
  }, [folders])

  // Check if in git repo when file path changes and auto-add to workspace.
  // If inside a git repo, adds the git root; otherwise adds the containing folder.
  useEffect(() => {
    if (filePath) {
      window.electron.git.isRepo().then(setIsGitRepo)

      window.electron.explorer.getGitRoot(filePath).then((result: { success: boolean; gitRoot?: string | null }) => {
        if (result.success && result.gitRoot) {
          if (!folders.some(f => f.path === result.gitRoot)) {
            setFolders(prev => [...prev, { path: result.gitRoot!, isGitRepo: true }])
          }
        } else {
          // Not inside a git repo — add the containing folder, but only if
          // it isn't already inside an existing workspace folder (e.g. an
          // imported file landing in a subfolder of an open workspace)
          const parentDir = filePath.substring(0, filePath.lastIndexOf('/'))
          const alreadyCovered = folders.some(f => parentDir.startsWith(f.path + '/') || parentDir === f.path)
          if (parentDir && !alreadyCovered) {
            setFolders(prev => [...prev, { path: parentDir, isGitRepo: false }])
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

  // Handle import: triggered from menu, delegates to main process
  const handleImport = useCallback(async () => {
    await window.electron.converter.importWithDialog()
  }, [])

  // Import a URL as markdown, showing a loading tab while fetching.
  // Used by both the menu dialog and the editor drop handler.
  const importUrlToTab = useCallback(async (url: string) => {
    // Open a loading placeholder tab immediately so the user sees feedback
    const tabId = `url-import-${Date.now()}`
    const loadingTab: Tab = {
      id: tabId,
      filePath: null,
      title: 'Importing...',
      content: `Importing ${url}...`,
      savedContent: '',
      isDirty: false,
      fileType: 'markdown' as const
    }
    setTabs(prev => [...prev, loadingTab])
    setActiveTabId(tabId)

    const result = await window.electron.converter.importUrl(url)
    if (result.success && result.markdown) {
      // Replace loading tab content with the imported markdown
      setTabs(prev => prev.map(t => t.id === tabId ? {
        ...t,
        title: result.title || 'Imported Page',
        content: result.markdown!,
        isDirty: true
      } : t))
    } else {
      // Remove the loading tab on failure (error dialog shown by main process)
      setTabs(prev => prev.filter(t => t.id !== tabId))
    }
  }, [])

  // Handle URL import from menu dialog
  const handleImportUrl = useCallback(async (url: string) => {
    setShowUrlImport(false)
    await importUrlToTab(url)
  }, [importUrlToTab])

  // Handle export: gets current content and sends to main process
  const handleExport = useCallback(async (format: 'docx' | 'odt' | 'html') => {
    const currentContent = editorRef.current?.getContent() || content
    await window.electron.converter.exportFile(currentContent, format)
  }, [content])

  // Handle menu events
  useEffect(() => {
    const unsubTheme = window.electron.menu.onToggleTheme(setTheme)
    const unsubSplit = window.electron.menu.onToggleSplitView(() => setShowSplitView(v => !v))
    const unsubPalette = window.electron.menu.onOpenCommandPalette(() => setShowCommandPalette(true))
    const unsubExplorer = window.electron.menu.onToggleWorkspace(() => setShowWorkspace(v => !v))
    const unsubMarkus = window.electron.markus.onToggleAgent(() => setShowAgent(v => !v))
    const unsubOpenFolder = window.electron.explorer.onOpenFolder((data: { path: string }) => {
      addFolderToWorkspace(data.path)
      setShowWorkspace(true)
    })
    const unsubAddComment = window.electron.menu.onAddComment(() => {
      editorRef.current?.addComment()
    })
    const unsubToggleComments = window.electron.menu.onToggleComments(() => {
      editorRef.current?.toggleComments()
    })
    const unsubShowEdits = window.electron.menu.onToggleShowEdits(() => setShowEdits(v => !v))
    const unsubOpenSettings = window.electron.menu.onOpenSettings(() => {
      setShowSettings(true)
    })
    const unsubToggleTerminal = window.electron.menu.onToggleTerminal(() => {
      setShowTerminal(v => !v)
    })

    // Import/export menu events
    const unsubImport = window.electron.converter.onImport(handleImport)
    const unsubImportUrl = window.electron.converter.onImportUrl(() => setShowUrlImport(true))
    const unsubExportDocx = window.electron.converter.onExportDocx(() => handleExport('docx'))
    const unsubExportOdt = window.electron.converter.onExportOdt(() => handleExport('odt'))
    const unsubExportHtml = window.electron.converter.onExportHtml(() => handleExport('html'))

    return () => {
      unsubTheme()
      unsubSplit()
      unsubPalette()
      unsubExplorer()
      unsubMarkus()
      unsubOpenFolder()
      unsubAddComment()
      unsubToggleComments()
      unsubShowEdits()
      unsubOpenSettings()
      unsubToggleTerminal()
      unsubImport()
      unsubImportUrl()
      unsubExportDocx()
      unsubExportOdt()
      unsubExportHtml()
    }
  }, [addFolderToWorkspace, handleImport, handleImportUrl, handleExport])

  // Auto-open agent panel when @markus is mentioned in a comment
  useEffect(() => {
    return onCommentToAgent(() => {
      setShowAgent(true)
    })
  }, [])

  // Handle Save As
  const handleSaveAs = useCallback(async () => {
    const currentContent = editorRef.current?.getContent() || content
    const result = await window.electron.file.saveAs(currentContent)
    if (result.success && result.filePath && activeTabId) {
      markTabSaved(activeTabId, currentContent, result.filePath)
    }
  }, [content, activeTabId, markTabSaved])

  // Handle opening folder from workspace
  const handleOpenFolder = useCallback(async () => {
    const result = await window.electron.explorer.openFolder()
    if (result.success && result.path) {
      addFolderToWorkspace(result.path)
    }
  }, [addFolderToWorkspace])

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
      // Ctrl+B - Toggle workspace
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault()
        setShowWorkspace(v => !v)
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
      // Ctrl+M - Toggle agent panel
      if ((e.metaKey || e.ctrlKey) && e.key === 'm') {
        e.preventDefault()
        setShowAgent(v => !v)
      }
      // Ctrl+, - Open settings
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault()
        setShowSettings(true)
      }
      // Ctrl+Shift+T - Toggle terminal
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'T') {
        e.preventDefault()
        setShowTerminal(v => !v)
      }
      // Ctrl+Shift+A - Add folder to workspace
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'A') {
        e.preventDefault()
        handleOpenFolder()
      }
      // Ctrl+N - New window (handled by main process)
      // We don't prevent default here, let it go to the main process
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSaveAs, createNewTab, closeTab, activeTabId, handleOpenFolder])

  // Handle opening file from explorer
  const handleOpenFileFromExplorer = useCallback(async (openFilePath: string) => {
    await window.electron.file.openPath(openFilePath)
  }, [])

  // Handle drag and drop
  useEffect(() => {
    // Extensions that should trigger the import conversion dialog
    const IMPORTABLE_EXTENSIONS = ['.docx', '.doc', '.odt', '.pdf']

    const handleDrop = async (e: DragEvent) => {
      // Skip if already handled by a nested handler (e.g., FileTreeItem's onDrop).
      // React's stopPropagation only stops synthetic events, but preventDefault
      // propagates to the native event — so we use it as a signal.
      if (e.defaultPrevented) return
      e.preventDefault()
      e.stopPropagation()

      // Check for URL drops (e.g., dragging a link from a browser).
      // When dragging a URL, dataTransfer has text but no files.
      const droppedUrl = extractDroppedUrl(e.dataTransfer)
      if (droppedUrl) {
        await importUrlToTab(droppedUrl)
        return
      }

      const items = Array.from(e.dataTransfer?.files || [])
      if (items.length === 0) return

      const firstItem = items[0] as File & { path: string }
      const droppedPath = firstItem.path
      if (!droppedPath) return

      // Check if the file is an importable document format (DOCX, ODT, PDF).
      // These would open as garbled raw content without conversion, so we
      // intercept them before the normal file-open path.
      const ext = '.' + (droppedPath.split('.').pop() || '').toLowerCase()
      if (IMPORTABLE_EXTENSIONS.includes(ext)) {
        const basename = droppedPath.split('/').pop() || droppedPath
        const result = await window.electron.dialog.showMessage({
          type: 'question',
          title: 'Convert to Markdown?',
          message: `Convert "${basename}" to Markdown?`,
          buttons: ['Convert', 'Cancel']
        })
        if (result.response === 0) {
          await window.electron.converter.importFile(droppedPath)
        }
        return
      }

      const fileType = getFileType(droppedPath)
      const isSupported = isSupportedFile(fileType)

      if (isSupported) {
        // Open supported files in the editor
        await window.electron.file.openPath(droppedPath)
      } else {
        // For unsupported files or folders, try to add to workspace
        const gitResult = await window.electron.explorer.getGitRoot(droppedPath)
        if (gitResult.success && gitResult.gitRoot) {
          addFolderToWorkspace(gitResult.gitRoot)
          setShowWorkspace(true)
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
  }, [addFolderToWorkspace, importUrlToTab])

  const handleContentChange = useCallback((newContent: string, newWordCount: number, newCharCount: number) => {
    if (activeTabId) {
      updateTabContent(activeTabId, newContent)
    }
    setWordCount(newWordCount)
    setCharCount(newCharCount)
  }, [activeTabId, updateTabContent])

  /**
   * Handles changes from the split view code editor.
   * Updates tab content immediately (so save always works) and pushes
   * to ProseMirror on a 300ms debounce to keep the WYSIWYG side in sync.
   * The CodeEditor's hasTextFocus() guard prevents ProseMirror's
   * re-serialized output from resetting the cursor while the user types.
   */
  const handleSplitCodeChange = useCallback((newContent: string) => {
    if (activeTabId) {
      updateTabContent(activeTabId, newContent)
    }
    if (splitSyncTimerRef.current) clearTimeout(splitSyncTimerRef.current)
    splitSyncTimerRef.current = setTimeout(() => {
      editorRef.current?.setContent(newContent)
    }, 300)
  }, [activeTabId, updateTabContent])

  // Clean up split sync timer
  useEffect(() => {
    return () => {
      if (splitSyncTimerRef.current) clearTimeout(splitSyncTimerRef.current)
    }
  }, [])

  const handleSave = useCallback(async () => {
    // Flush any pending split view sync so ProseMirror has the latest content
    if (splitSyncTimerRef.current) {
      clearTimeout(splitSyncTimerRef.current)
      splitSyncTimerRef.current = undefined
    }
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
    { id: 'workspace', label: 'Toggle Workspace', shortcut: 'Ctrl+B', action: () => setShowWorkspace(v => !v) },
    { id: 'agent', label: 'Toggle Agent', shortcut: 'Ctrl+M', action: () => setShowAgent(v => !v) },
    { id: 'split', label: 'Toggle Split View', shortcut: 'Ctrl+\\', action: () => setShowSplitView(v => !v) },
    { id: 'theme-light', label: 'Light Theme', action: () => setTheme('light') },
    { id: 'theme-dark', label: 'Dark Theme', action: () => setTheme('dark') },
    { id: 'theme-system', label: 'System Theme', action: () => setTheme('system') },
    { id: 'addComment', label: 'Add Comment', shortcut: 'Ctrl+Alt+M', action: () => editorRef.current?.addComment() },
    { id: 'toggleComments', label: 'Toggle Comments', action: () => editorRef.current?.toggleComments() },
    { id: 'toggleMetadata', label: 'Toggle Metadata', action: () => editorRef.current?.toggleMetadata() },
    { id: 'terminal', label: 'Toggle Terminal', shortcut: 'Ctrl+Shift+T', action: () => setShowTerminal(v => !v) },
    { id: 'settings', label: 'Settings', shortcut: 'Ctrl+,', action: () => setShowSettings(true) },
    { id: 'import', label: 'Import Document...', shortcut: 'Ctrl+Shift+I', action: handleImport },
    { id: 'exportDocx', label: 'Export as Word Document', action: () => handleExport('docx') },
    { id: 'exportOdt', label: 'Export as OpenDocument', action: () => handleExport('odt') },
    { id: 'exportHtml', label: 'Export as HTML', action: () => handleExport('html') },
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
        showWorkspace={showWorkspace}
        onToggleWorkspace={() => setShowWorkspace(v => !v)}
        showAgent={showAgent}
        onToggleAgent={() => setShowAgent(v => !v)}
        isVertical={isVertical}
      />

      {/* Quake-style dropdown terminal — fixed overlay, doesn't affect layout */}
      <QuakeTerminal
        visible={showTerminal}
        height={terminalHeight}
        onHeightChange={setTerminalHeight}
        opacity={terminalOpacity}
        onToggle={() => setShowTerminal(v => !v)}
        cwd={folders[0]?.path}
      />

      <main className={cn("flex-1 flex overflow-hidden", isVertical && "flex-col")}>
        {/* Workspace with multiple folder panels */}
        {showWorkspace && (
          <>
            <div
              className={cn(
                "flex flex-col flex-shrink-0 overflow-hidden",
                isVertical ? "border-b border-border" : "border-r border-border"
              )}
              style={isVertical ? { height: workspaceDimension } : { width: workspaceDimension }}
            >
              <Workspace
                folders={folders}
                onFoldersChange={setFolders}
                onAddFolder={addFolderToWorkspace}
                onOpenFile={handleOpenFileFromExplorer}
                activeFilePath={filePath}
                onConflict={(conflictContent) => {
                  const conflict = parseConflicts(conflictContent, filePath || '')
                  if (conflict.sections.length > 0) {
                    setActiveConflict(conflict)
                  }
                }}
                showEdits={showEdits}
                onToggleShowEdits={setShowEdits}
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
                const startSize = workspaceDimension

                const handleMouseMove = (e: MouseEvent) => {
                  const currentPos = isVertical ? e.clientY : e.clientX
                  const [min, max] = isVertical ? [100, 400] : [150, 500]
                  const newSize = Math.max(min, Math.min(max, startSize + currentPos - startPos))
                  setWorkspaceDimension(newSize)
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
                  commentAuthor={commentAuthor}
                  showEdits={showEdits}
                />
              </div>
            </div>
            {/* Split view: raw markdown source in Monaco code editor */}
            {showSplitView && activeTab.fileType === 'markdown' && (
              <div className="w-1/2 border-l border-border overflow-hidden">
                <CodeEditor
                  content={content}
                  filePath={filePath}
                  onChange={handleSplitCodeChange}
                  onSave={handleSave}
                />
              </div>
            )}
          </>
        )}

        {/* Agent widget */}
        {showAgent && (
          <>
            {/* Resize handle */}
            <div
              className={cn(
                "hover:bg-primary/50 active:bg-primary transition-colors",
                isVertical ? "h-1 cursor-row-resize" : "w-1 cursor-col-resize",
                isResizingAgent && "bg-primary"
              )}
              onMouseDown={(e) => {
                e.preventDefault()
                setIsResizingAgent(true)
                const startPos = isVertical ? e.clientY : e.clientX
                const startSize = agentDimension

                const handleMouseMove = (e: MouseEvent) => {
                  // Markus panel resizes from the top/left edge, so subtract delta
                  const currentPos = isVertical ? e.clientY : e.clientX
                  const [min, max] = isVertical ? [150, 500] : [250, 600]
                  const newSize = Math.max(min, Math.min(max, startSize - (currentPos - startPos)))
                  setAgentDimension(newSize)
                }

                const handleMouseUp = () => {
                  setIsResizingAgent(false)
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
              style={isVertical ? { height: agentDimension } : { width: agentDimension }}
            >
              <AgentWidget
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

      <SettingsView
        open={showSettings}
        onOpenChange={setShowSettings}
      />

      <UrlInputDialog
        isOpen={showUrlImport}
        onSubmit={handleImportUrl}
        onClose={() => setShowUrlImport(false)}
      />

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
