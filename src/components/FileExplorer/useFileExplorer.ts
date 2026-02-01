/**
 * File Explorer Hook
 *
 * Manages the state and logic for the file explorer sidebar.
 * Handles loading directories, expanding/collapsing folders, and git status updates.
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import {
  FileTreeNode,
  GitStatus,
  updateNodeInTree,
  applyGitStatusToTree,
  sortNodes
} from '../../lib/fileTree'

interface FileEntry {
  name: string
  path: string
  type: 'file' | 'directory'
}

interface UseFileExplorerOptions {
  rootPath: string | null
  onOpenFile?: (filePath: string) => void
}

interface UseFileExplorerReturn {
  tree: FileTreeNode[]
  selectedPath: string | null
  isLoading: boolean
  error: string | null
  refresh: () => Promise<void>
  selectNode: (node: FileTreeNode) => void
  toggleExpand: (node: FileTreeNode) => Promise<void>
  openSelectedFile: () => void
}

export function useFileExplorer({ rootPath, onOpenFile }: UseFileExplorerOptions): UseFileExplorerReturn {
  const [tree, setTree] = useState<FileTreeNode[]>([])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Use refs for git status map to avoid recreating the refresh function
  const gitStatusMapRef = useRef<Map<string, GitStatus>>(new Map())

  /**
   * Loads entries from a directory and converts them to tree nodes.
   */
  const loadDirectory = useCallback(async (dirPath: string): Promise<FileTreeNode[]> => {
    const result = await window.electron.explorer.readDirectory(dirPath)

    if (!result.success || !result.entries) {
      return []
    }

    return result.entries.map((entry: FileEntry) => ({
      id: entry.path,
      name: entry.name,
      path: entry.path,
      type: entry.type,
      isExpanded: false,
      children: entry.type === 'directory' ? undefined : undefined,
      gitStatus: gitStatusMapRef.current.get(entry.path) || null
    }))
  }, [])

  /**
   * Fetches git status for all files in the repository.
   */
  const loadGitStatus = useCallback(async (gitRoot: string) => {
    const result = await window.electron.explorer.getGitStatus(gitRoot)

    if (result.success && result.files) {
      const statusMap = new Map<string, GitStatus>()
      for (const file of result.files) {
        statusMap.set(file.path, file.status)
      }
      gitStatusMapRef.current = statusMap
      return statusMap
    }

    return new Map<string, GitStatus>()
  }, [])

  /**
   * Loads the root directory and initializes the tree.
   */
  const loadRoot = useCallback(async () => {
    if (!rootPath) {
      setTree([])
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      // First check if this is a git repo and load status
      const gitResult = await window.electron.explorer.getGitRoot(rootPath)
      if (gitResult.success && gitResult.gitRoot) {
        await loadGitStatus(gitResult.gitRoot)
      }

      // Load the root directory
      const entries = await loadDirectory(rootPath)
      const sortedEntries = sortNodes(entries)

      // Apply git status to nodes
      const treeWithStatus = applyGitStatusToTree(sortedEntries, gitStatusMapRef.current)
      setTree(treeWithStatus)

      // Start watching the directory for changes
      await window.electron.explorer.watchDirectory(rootPath)
    } catch (err) {
      setError(String(err))
    } finally {
      setIsLoading(false)
    }
  }, [rootPath, loadDirectory, loadGitStatus])

  /**
   * Refreshes the tree and git status.
   */
  const refresh = useCallback(async () => {
    await loadRoot()
  }, [loadRoot])

  /**
   * Toggles expansion of a directory node.
   * Lazy loads children when first expanded.
   */
  const toggleExpand = useCallback(async (node: FileTreeNode) => {
    if (node.type !== 'directory') return

    // If collapsing, just toggle the state
    if (node.isExpanded) {
      setTree(prev => updateNodeInTree(prev, node.path, n => ({
        ...n,
        isExpanded: false
      })))
      return
    }

    // If expanding and children not loaded, load them
    if (!node.children) {
      // Mark as loading
      setTree(prev => updateNodeInTree(prev, node.path, n => ({
        ...n,
        isLoading: true
      })))

      try {
        const children = await loadDirectory(node.path)
        const sortedChildren = sortNodes(children)
        const childrenWithStatus = applyGitStatusToTree(sortedChildren, gitStatusMapRef.current)

        setTree(prev => updateNodeInTree(prev, node.path, n => ({
          ...n,
          isLoading: false,
          isExpanded: true,
          children: childrenWithStatus
        })))
      } catch {
        setTree(prev => updateNodeInTree(prev, node.path, n => ({
          ...n,
          isLoading: false
        })))
      }
    } else {
      // Children already loaded, just toggle expanded
      setTree(prev => updateNodeInTree(prev, node.path, n => ({
        ...n,
        isExpanded: true
      })))
    }
  }, [loadDirectory])

  /**
   * Selects a node in the tree.
   */
  const selectNode = useCallback((node: FileTreeNode) => {
    setSelectedPath(node.path)
  }, [])

  /**
   * Opens the currently selected file.
   */
  const openSelectedFile = useCallback(() => {
    if (selectedPath) {
      onOpenFile?.(selectedPath)
    }
  }, [selectedPath, onOpenFile])

  // Load root when path changes
  useEffect(() => {
    loadRoot()

    // Cleanup watcher when component unmounts or path changes
    return () => {
      window.electron.explorer.unwatchDirectory()
    }
  }, [loadRoot])

  // Subscribe to directory change events
  useEffect(() => {
    const unsubscribe = window.electron.explorer.onDirectoryChanged(() => {
      // Debounced refresh is already handled in the watcher
      refresh()
    })

    return unsubscribe
  }, [refresh])

  return {
    tree,
    selectedPath,
    isLoading,
    error,
    refresh,
    selectNode,
    toggleExpand,
    openSelectedFile
  }
}
