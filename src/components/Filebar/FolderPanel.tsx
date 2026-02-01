/**
 * FolderPanel Component
 *
 * Displays a single folder with its file tree and Git controls (if applicable).
 * Each folder is wrapped in a bordered container for visual grouping.
 */

import { useState, useCallback, useEffect } from 'react'
import { ChevronDown, ChevronRight, Folder, X, GitBranch, Upload, Save, Loader2, AlertCircle, RefreshCw } from 'lucide-react'
import { FileTree } from '../FileExplorer/FileTree'
import { NewItemDialog } from '../FileExplorer/NewItemDialog'
import { useFileExplorer } from '../FileExplorer/useFileExplorer'
import { FileTreeNode } from '../../lib/fileTree'
import { getFileType, isSupportedFile } from '../../lib/fileTypes'
import { cn } from '../../lib/utils'

interface FolderPanelProps {
  path: string
  isGitRepo: boolean
  onOpenFile: (filePath: string) => void
  onRemove: () => void
  onConflict: (content: string) => void
}

/**
 * Gets the display name for a folder path.
 */
function getFolderName(folderPath: string): string {
  const parts = folderPath.split('/')
  return parts[parts.length - 1] || folderPath
}

export function FolderPanel({ path, isGitRepo, onOpenFile, onRemove, onConflict }: FolderPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const [newItemDialog, setNewItemDialog] = useState<{
    isOpen: boolean
    type: 'file' | 'folder'
    parentPath: string
  }>({ isOpen: false, type: 'file', parentPath: '' })

  // Git quick commit state
  const [message, setMessage] = useState('')
  const [isCommitting, setIsCommitting] = useState(false)
  const [isPushing, setIsPushing] = useState(false)
  const [gitError, setGitError] = useState<string | null>(null)
  const [gitStatus, setGitStatus] = useState<string | null>(null)
  const [aheadCount, setAheadCount] = useState(0)
  const [hasUncommittedChanges, setHasUncommittedChanges] = useState(false)

  /**
   * Checks git status and updates ahead count and uncommitted changes state.
   */
  const checkGitStatus = useCallback(async () => {
    if (!isGitRepo) return
    try {
      const status = await window.electron.git.status()
      setAheadCount(status.ahead)
      // Check if there are any uncommitted changes (modified, added, deleted files)
      setHasUncommittedChanges(status.files.length > 0)
    } catch {
      // Silently ignore errors
    }
  }, [isGitRepo])

  // Check git status on mount and after operations
  useEffect(() => {
    checkGitStatus()
    // Check periodically every 30 seconds
    const interval = setInterval(checkGitStatus, 30000)
    return () => clearInterval(interval)
  }, [checkGitStatus])

  const handleOpenFile = useCallback((filePath: string) => {
    const fileType = getFileType(filePath)
    if (isSupportedFile(fileType)) {
      onOpenFile(filePath)
    }
  }, [onOpenFile])

  const {
    tree,
    selectedPath,
    isLoading,
    error,
    refresh,
    selectNode,
    toggleExpand
  } = useFileExplorer({
    rootPath: path,
    onOpenFile: handleOpenFile
  })

  const handleSelect = useCallback((node: FileTreeNode) => {
    selectNode(node)
  }, [selectNode])

  const handleToggleExpand = useCallback(async (node: FileTreeNode) => {
    await toggleExpand(node)
  }, [toggleExpand])

  const handleOpenFileFromTree = useCallback((node: FileTreeNode) => {
    if (node.type === 'file') {
      handleOpenFile(node.path)
    }
  }, [handleOpenFile])

  const handleNewFile = useCallback((parentPath: string) => {
    setNewItemDialog({ isOpen: true, type: 'file', parentPath })
  }, [])

  const handleNewFolder = useCallback((parentPath: string) => {
    setNewItemDialog({ isOpen: true, type: 'folder', parentPath })
  }, [])

  const handleCloseDialog = useCallback(() => {
    setNewItemDialog(prev => ({ ...prev, isOpen: false }))
  }, [])

  const handleCreateItem = useCallback(async (name: string) => {
    const fullPath = `${newItemDialog.parentPath}/${name}`

    if (newItemDialog.type === 'file') {
      const result = await window.electron.explorer.createFile(fullPath)
      if (result.success) {
        handleCloseDialog()
        refresh()
        const fileType = getFileType(fullPath)
        if (isSupportedFile(fileType)) {
          onOpenFile(fullPath)
        }
      } else {
        await window.electron.dialog.showMessage({
          type: 'error',
          title: 'Error',
          message: result.error || 'Failed to create file',
          buttons: ['OK']
        })
      }
    } else {
      const result = await window.electron.explorer.createDirectory(fullPath)
      if (result.success) {
        handleCloseDialog()
        refresh()
      } else {
        await window.electron.dialog.showMessage({
          type: 'error',
          title: 'Error',
          message: result.error || 'Failed to create folder',
          buttons: ['OK']
        })
      }
    }
  }, [newItemDialog.parentPath, newItemDialog.type, handleCloseDialog, refresh, onOpenFile])

  // Git commit handler
  const handleCommit = useCallback(async () => {
    if (!message.trim()) {
      setGitError('Please enter a commit message')
      return
    }

    setIsCommitting(true)
    setGitError(null)
    setGitStatus(null)

    try {
      const addResult = await window.electron.git.addAll()
      if (!addResult.success) {
        setGitError(addResult.error || 'Failed to stage changes')
        return
      }

      const commitResult = await window.electron.git.commit(message.trim())
      if (!commitResult.success) {
        setGitError(commitResult.error || 'Failed to commit')
        return
      }

      setMessage('')
      setGitStatus('Changes saved')
      checkGitStatus()
      setTimeout(() => setGitStatus(null), 3000)
    } catch (err) {
      setGitError(String(err))
    } finally {
      setIsCommitting(false)
    }
  }, [message, checkGitStatus])

  // Git push handler
  const handlePush = useCallback(async () => {
    setIsPushing(true)
    setGitError(null)
    setGitStatus(null)

    try {
      if (message.trim()) {
        const addResult = await window.electron.git.addAll()
        if (!addResult.success) {
          setGitError(addResult.error || 'Failed to stage changes')
          return
        }

        const commitResult = await window.electron.git.commit(message.trim())
        if (!commitResult.success) {
          setGitError(commitResult.error || 'Failed to commit')
          return
        }
        setMessage('')
      }

      const pushResult = await window.electron.git.pushWithConflictHandling()

      if (!pushResult.success) {
        setGitError(pushResult.error || 'Failed to push')
        return
      }

      if (pushResult.hasConflicts && pushResult.content) {
        onConflict(pushResult.content)
        return
      }

      setGitStatus('Synced')
      checkGitStatus()
      setTimeout(() => setGitStatus(null), 3000)
    } catch (err) {
      setGitError(String(err))
    } finally {
      setIsPushing(false)
    }
  }, [message, onConflict, checkGitStatus])

  const isGitLoading = isCommitting || isPushing

  return (
    <div className="border border-border rounded-md m-1 overflow-hidden bg-background">
      {/* Folder header */}
      <div
        className="flex items-center gap-1 px-2 py-1.5 bg-muted/50 cursor-pointer hover:bg-muted/70"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        )}
        <Folder className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <span className="text-sm font-medium truncate flex-1">{getFolderName(path)}</span>
        {isGitRepo && (
          <span title="Git repository">
            <GitBranch className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          </span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation()
            refresh()
          }}
          className="p-0.5 hover:bg-accent rounded opacity-0 group-hover:opacity-100"
          title="Refresh"
        >
          <RefreshCw className={cn("w-3.5 h-3.5 text-muted-foreground", isLoading && "animate-spin")} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="p-0.5 hover:bg-accent rounded"
          title="Remove folder"
        >
          <X className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
        </button>
      </div>

      {isExpanded && (
        <>
          {/* Git controls (only for git repos) */}
          {isGitRepo && (
            <div className="px-2 py-2 border-b border-border bg-muted/30 space-y-2">
              <input
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Change summary"
                disabled={isGitLoading}
                className={cn(
                  'w-full px-2 py-1 text-xs rounded border border-border',
                  'bg-background placeholder:text-muted-foreground',
                  'focus:outline-none focus:ring-1 focus:ring-ring',
                  'disabled:opacity-50'
                )}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleCommit()
                  }
                }}
              />
              <div className="flex gap-1">
                <button
                  onClick={handleCommit}
                  disabled={isGitLoading || !message.trim()}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs rounded',
                    'bg-secondary text-secondary-foreground',
                    'hover:bg-secondary/80 transition-colors',
                    'disabled:opacity-50 disabled:cursor-not-allowed'
                  )}
                  title="Stage all and commit"
                >
                  {isCommitting ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Save className="w-3 h-3" />
                  )}
                  Save
                </button>
                <button
                  onClick={handlePush}
                  disabled={isGitLoading || (aheadCount === 0 && !message.trim() && !hasUncommittedChanges)}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs rounded',
                    'bg-blue-600 dark:bg-blue-700 text-white',
                    'hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors',
                    'disabled:opacity-50 disabled:cursor-not-allowed'
                  )}
                  title={aheadCount === 0 && !message.trim() && !hasUncommittedChanges ? 'Nothing to sync' : 'Commit and push'}
                >
                  {isPushing ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Upload className="w-3 h-3" />
                  )}
                  Sync
                </button>
              </div>
              {gitError && (
                <div className="flex items-start gap-1 text-xs text-destructive">
                  <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  <span className="truncate">{gitError}</span>
                </div>
              )}
              {gitStatus && (
                <div className="text-xs text-green-600 dark:text-green-400">
                  {gitStatus}
                </div>
              )}
            </div>
          )}

          {/* File tree */}
          <div className="max-h-64 overflow-auto filebar-scroll">
            {isLoading && tree.length === 0 ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <div className="p-2 text-xs text-destructive">{error}</div>
            ) : tree.length === 0 ? (
              <div className="p-2 text-xs text-muted-foreground text-center">Empty folder</div>
            ) : (
              <FileTree
                nodes={tree}
                selectedPath={selectedPath}
                onSelect={handleSelect}
                onToggleExpand={handleToggleExpand}
                onOpenFile={handleOpenFileFromTree}
                onNewFile={handleNewFile}
                onNewFolder={handleNewFolder}
              />
            )}
          </div>
        </>
      )}

      <NewItemDialog
        isOpen={newItemDialog.isOpen}
        type={newItemDialog.type}
        parentPath={newItemDialog.parentPath}
        onClose={handleCloseDialog}
        onCreate={handleCreateItem}
      />
    </div>
  )
}
