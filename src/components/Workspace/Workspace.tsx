/**
 * Workspace Component
 *
 * Side panel that displays multiple folder panels.
 * Each folder can have its own Git controls if it's a git repository.
 * Supports adding and removing folders, and saving/loading workspace configurations.
 */

import { useState, useCallback, useEffect } from 'react'
import { FolderPlus, Save, FolderOpen, Clock, Loader2 } from 'lucide-react'
import { FolderPanel } from './FolderPanel'
import { SaveWorkspaceDialog } from './SaveWorkspaceDialog'
import { LoadWorkspaceDialog } from './LoadWorkspaceDialog'
import { cn } from '../../lib/utils'

interface WorkspaceListItem {
  name: string
  fileName: string
  folderCount: number
}

export interface FolderEntry {
  path: string
  isGitRepo: boolean
}

interface WorkspaceProps {
  folders: FolderEntry[]
  onFoldersChange: (folders: FolderEntry[]) => void
  onOpenFile: (filePath: string) => void
  onConflict: (content: string) => void
  activeFilePath?: string | null
}

export function Workspace({ folders, onFoldersChange, onOpenFile, onConflict, activeFilePath }: WorkspaceProps) {
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [showLoadDialog, setShowLoadDialog] = useState(false)
  const [recentWorkspaces, setRecentWorkspaces] = useState<WorkspaceListItem[]>([])
  const [isLoadingRecent, setIsLoadingRecent] = useState(false)
  const [loadingFileName, setLoadingFileName] = useState<string | null>(null)

  /**
   * Fetches the list of saved workspaces for the "Latest workspaces" section.
   */
  const fetchRecentWorkspaces = useCallback(async () => {
    setIsLoadingRecent(true)
    try {
      const result = await window.electron.workspace.list()
      if (result.success) {
        // Show up to 5 most recent workspaces
        setRecentWorkspaces(result.workspaces.slice(0, 5))
      }
    } catch {
      // Silently fail - this is a convenience feature
    } finally {
      setIsLoadingRecent(false)
    }
  }, [])

  // Load recent workspaces when component mounts and when folders become empty
  useEffect(() => {
    if (folders.length === 0) {
      fetchRecentWorkspaces()
    }
  }, [folders.length, fetchRecentWorkspaces])

  /**
   * Loads a workspace from the recent list.
   */
  const handleQuickLoadWorkspace = useCallback(async (fileName: string) => {
    setLoadingFileName(fileName)
    try {
      const result = await window.electron.workspace.load(fileName)
      if (result.success && result.folders) {
        onFoldersChange(result.folders)
      }
    } catch {
      // Silently fail
    } finally {
      setLoadingFileName(null)
    }
  }, [onFoldersChange])

  /**
   * Adds a new folder to the workspace.
   */
  const handleAddFolder = useCallback(async () => {
    const result = await window.electron.explorer.openFolder()
    if (result.success && result.path) {
      // Check if folder is already open
      if (folders.some(f => f.path === result.path)) {
        return
      }

      // Check if it's a git repo
      const isGitRepo = await window.electron.git.isRepoAtPath(result.path)

      // If it's inside a git repo, get the git root
      if (!isGitRepo) {
        const gitRootResult = await window.electron.explorer.getGitRoot(result.path)
        if (gitRootResult.success && gitRootResult.gitRoot) {
          // Check if git root is already open
          if (!folders.some(f => f.path === gitRootResult.gitRoot)) {
            onFoldersChange([...folders, { path: gitRootResult.gitRoot, isGitRepo: true }])
            return
          }
        }
      }

      onFoldersChange([...folders, { path: result.path, isGitRepo }])
    }
  }, [folders, onFoldersChange])

  /**
   * Removes a folder from the workspace.
   */
  const handleRemoveFolder = useCallback((path: string) => {
    onFoldersChange(folders.filter(f => f.path !== path))
  }, [folders, onFoldersChange])

  /**
   * Saves the current workspace configuration.
   */
  const handleSaveWorkspace = useCallback(async (name: string) => {
    const result = await window.electron.workspace.save(name, folders)
    if (!result.success) {
      throw new Error(result.error || 'Failed to save workspace')
    }
  }, [folders])

  /**
   * Loads a workspace configuration.
   */
  const handleLoadWorkspace = useCallback(async (fileName: string) => {
    const result = await window.electron.workspace.load(fileName)
    if (result.success && result.folders) {
      onFoldersChange(result.folders)
    } else {
      throw new Error(result.error || 'Failed to load workspace')
    }
  }, [onFoldersChange])

  return (
    <div className="h-full flex flex-col bg-muted/20 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Workspace
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setShowSaveDialog(true)}
            className="p-1 hover:bg-accent rounded disabled:opacity-50"
            title="Save workspace"
            disabled={folders.length === 0}
          >
            <Save className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
          </button>
          <button
            onClick={() => setShowLoadDialog(true)}
            className="p-1 hover:bg-accent rounded"
            title="Load workspace"
          >
            <FolderOpen className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
          </button>
          <button
            onClick={handleAddFolder}
            className="p-1 hover:bg-accent rounded"
            title="Add folder"
          >
            <FolderPlus className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
          </button>
        </div>
      </div>

      {/* Folder panels */}
      <div className="flex-1 overflow-auto widget-scroll p-1">
        {folders.length === 0 ? (
          <div className="flex flex-col h-full p-4">
            {/* Top section - Add folder */}
            <div className="flex flex-col items-center text-center mb-6">
              <FolderPlus className="w-10 h-10 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground mb-3">
                No folders open
              </p>
              <button
                onClick={handleAddFolder}
                className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90"
              >
                Add Folder
              </button>
            </div>

            {/* Latest workspaces section */}
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Latest Workspaces
                </span>
              </div>

              {isLoadingRecent ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              ) : recentWorkspaces.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">
                  No saved workspaces yet
                </p>
              ) : (
                <div className="space-y-1">
                  {recentWorkspaces.map((workspace) => (
                    <button
                      key={workspace.fileName}
                      onClick={() => handleQuickLoadWorkspace(workspace.fileName)}
                      disabled={loadingFileName !== null}
                      className={cn(
                        'w-full flex items-center gap-2 px-2 py-1.5 rounded text-left',
                        'hover:bg-accent/50 transition-colors',
                        'disabled:opacity-50 disabled:cursor-not-allowed'
                      )}
                    >
                      <FolderOpen className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{workspace.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {workspace.folderCount} {workspace.folderCount === 1 ? 'folder' : 'folders'}
                        </div>
                      </div>
                      {loadingFileName === workspace.fileName && (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* Show all workspaces button */}
              {recentWorkspaces.length > 0 && (
                <button
                  onClick={() => setShowLoadDialog(true)}
                  className="w-full mt-2 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded text-center"
                >
                  Show all workspaces...
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col h-full">
            <div className="flex-1">
              {folders.map((folder) => (
                <FolderPanel
                  key={folder.path}
                  path={folder.path}
                  isGitRepo={folder.isGitRepo}
                  onOpenFile={onOpenFile}
                  onRemove={() => handleRemoveFolder(folder.path)}
                  onConflict={onConflict}
                  activeFilePath={activeFilePath}
                />
              ))}
            </div>
            {/* Add folder button at bottom */}
            <button
              onClick={handleAddFolder}
              className="flex items-center justify-center gap-1.5 m-1 p-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded border border-dashed border-border"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              Add Folder
            </button>
          </div>
        )}
      </div>

      {/* Dialogs */}
      <SaveWorkspaceDialog
        isOpen={showSaveDialog}
        onClose={() => setShowSaveDialog(false)}
        onSave={handleSaveWorkspace}
      />
      <LoadWorkspaceDialog
        isOpen={showLoadDialog}
        onClose={() => setShowLoadDialog(false)}
        onLoad={handleLoadWorkspace}
      />
    </div>
  )
}
