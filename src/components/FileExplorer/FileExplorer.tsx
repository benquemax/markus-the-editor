/**
 * File Explorer Component
 *
 * Main sidebar container for the file explorer.
 * Shows the folder tree with git status highlighting and provides
 * controls for opening folders and refreshing the view.
 */

import { useState } from 'react'
import { FolderOpen, RefreshCw, Loader2 } from 'lucide-react'
import { FileTree } from './FileTree'
import { NewItemDialog } from './NewItemDialog'
import { useFileExplorer } from './useFileExplorer'
import { FileTreeNode } from '../../lib/fileTree'
import { getFileType, isSupportedFile } from '../../lib/fileTypes'
import { useCallback } from 'react'

interface FileExplorerProps {
  rootPath: string | null
  onOpenFolder: () => void
  onOpenFile: (filePath: string) => void
}

/**
 * Gets the display name for the root folder.
 */
function getFolderName(rootPath: string): string {
  const parts = rootPath.split('/')
  return parts[parts.length - 1] || rootPath
}

export function FileExplorer({ rootPath, onOpenFolder, onOpenFile }: FileExplorerProps) {
  const [newItemDialog, setNewItemDialog] = useState<{
    isOpen: boolean
    type: 'file' | 'folder'
    parentPath: string
  }>({ isOpen: false, type: 'file', parentPath: '' })

  const handleOpenFile = useCallback((filePath: string) => {
    // Open all supported file types in the editor/viewer
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
    rootPath,
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
        // Open the new file if it's a supported type
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

  return (
    <div className="h-full bg-muted/30 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Explorer
        </span>
        <div className="flex items-center gap-1">
          {rootPath && (
            <button
              onClick={refresh}
              disabled={isLoading}
              className="p-1 hover:bg-accent rounded"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-muted-foreground ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {/* Folder name */}
      {rootPath && (
        <div className="px-3 py-1.5 text-sm font-medium truncate border-b border-border">
          {getFolderName(rootPath)}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {!rootPath ? (
          // No folder open - show open folder button
          <div className="flex flex-col items-center justify-center h-full p-4 text-center">
            <FolderOpen className="w-12 h-12 text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground mb-3">
              No folder open
            </p>
            <button
              onClick={onOpenFolder}
              className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90"
            >
              Open Folder
            </button>
          </div>
        ) : isLoading && tree.length === 0 ? (
          // Loading state
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          // Error state
          <div className="p-4 text-sm text-destructive">
            {error}
          </div>
        ) : tree.length === 0 ? (
          // Empty folder
          <div className="p-4 text-sm text-muted-foreground text-center">
            Folder is empty
          </div>
        ) : (
          // File tree
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

      {/* New item dialog */}
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
