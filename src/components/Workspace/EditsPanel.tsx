/**
 * EditsPanel Component
 *
 * Shows a filtered view of all edited files across workspace repositories.
 * Only displays files with git status: modified, added, deleted, renamed.
 * Rendered when the "Edits" tab is active in the Workspace sidebar.
 */

import { useState, useEffect, useCallback } from 'react'
import { GitBranch, FileText, Loader2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import { getFileType, isSupportedFile } from '../../lib/fileTypes'
import type { FolderEntry } from './Workspace'

type EditStatus = 'modified' | 'added' | 'deleted' | 'renamed'

interface EditedFile {
  path: string
  name: string
  status: EditStatus
}

interface RepoEdits {
  repoPath: string
  repoName: string
  files: EditedFile[]
}

interface EditsPanelProps {
  folders: FolderEntry[]
  onOpenFile: (filePath: string) => void
  activeFilePath?: string | null
}

/**
 * Returns the background color class for a git status dot.
 */
function statusDotColor(status: EditStatus): string {
  switch (status) {
    case 'modified': return 'bg-yellow-500'
    case 'added': return 'bg-green-500'
    case 'deleted': return 'bg-red-500'
    case 'renamed': return 'bg-blue-500'
  }
}

/**
 * Returns the text color class for a git status label.
 */
function statusTextColor(status: EditStatus): string {
  switch (status) {
    case 'modified': return 'text-yellow-500'
    case 'added': return 'text-green-500'
    case 'deleted': return 'text-red-500'
    case 'renamed': return 'text-blue-500'
  }
}

/**
 * Extracts the display name from a folder path (last segment).
 */
function folderDisplayName(folderPath: string): string {
  return folderPath.split('/').filter(Boolean).pop() || folderPath
}

/**
 * Extracts the file name from a full path, showing the relative path
 * from the repo root for clarity.
 */
function relativeFileName(filePath: string, repoPath: string): string {
  if (filePath.startsWith(repoPath)) {
    const rel = filePath.slice(repoPath.length)
    return rel.startsWith('/') ? rel.slice(1) : rel
  }
  return filePath.split('/').pop() || filePath
}

export function EditsPanel({ folders, onOpenFile, activeFilePath }: EditsPanelProps) {
  const [repoEdits, setRepoEdits] = useState<RepoEdits[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const fetchEdits = useCallback(async () => {
    const gitFolders = folders.filter(f => f.isGitRepo)
    if (gitFolders.length === 0) {
      setRepoEdits([])
      setIsLoading(false)
      return
    }

    const results: RepoEdits[] = []

    for (const folder of gitFolders) {
      try {
        const result = await window.electron.explorer.getGitStatus(folder.path)
        if (result.success && result.files) {
          type GitFile = { path: string; status: string }
          const files: GitFile[] = result.files
          const editedFiles = files
            .filter(f =>
              f.status === 'modified' ||
              f.status === 'added' ||
              f.status === 'deleted' ||
              f.status === 'renamed'
            )
            .map(f => ({
              path: f.path,
              name: relativeFileName(f.path, folder.path),
              status: f.status as EditStatus
            }))

          if (editedFiles.length > 0) {
            results.push({
              repoPath: folder.path,
              repoName: folderDisplayName(folder.path),
              files: editedFiles
            })
          }
        }
      } catch {
        // Silently skip repos that fail to return status
      }
    }

    setRepoEdits(results)
    setIsLoading(false)
  }, [folders])

  // Fetch on mount and when folders change
  useEffect(() => {
    fetchEdits()
  }, [fetchEdits])

  // Poll every 30 seconds (matching FolderPanel's interval)
  useEffect(() => {
    const interval = setInterval(fetchEdits, 30000)
    return () => clearInterval(interval)
  }, [fetchEdits])

  // Refresh after git commits
  useEffect(() => {
    window.addEventListener('git:committed', fetchEdits)
    return () => window.removeEventListener('git:committed', fetchEdits)
  }, [fetchEdits])

  const handleFileClick = useCallback((filePath: string) => {
    const fileType = getFileType(filePath)
    if (isSupportedFile(fileType)) {
      onOpenFile(filePath)
    }
  }, [onOpenFile])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (repoEdits.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center px-4">
        <FileText className="w-8 h-8 text-muted-foreground/40 mb-2" />
        <p className="text-xs text-muted-foreground">No edits</p>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {repoEdits.map(repo => (
        <div key={repo.repoPath} className="border border-border rounded-md m-1 overflow-hidden">
          {/* Repo header */}
          <div className="flex items-center gap-1.5 px-2 py-1.5 bg-amber-500/5 dark:bg-amber-400/5">
            <GitBranch className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
            <span className="text-xs font-medium text-amber-600 dark:text-amber-400 truncate">
              {repo.repoName}
            </span>
            <span className="text-[10px] text-muted-foreground ml-auto flex-shrink-0">
              {repo.files.length}
            </span>
          </div>

          {/* File list */}
          <div className="max-h-64 overflow-auto widget-scroll">
            {repo.files.map(file => (
              <div
                key={file.path}
                onClick={() => handleFileClick(file.path)}
                className={cn(
                  'flex items-center gap-2 px-2 py-1 cursor-pointer text-xs',
                  'hover:bg-accent transition-colors',
                  activeFilePath === file.path && 'bg-accent'
                )}
              >
                <FileText className={cn('w-3.5 h-3.5 flex-shrink-0', statusTextColor(file.status))} />
                <span className="truncate flex-1">{file.name}</span>
                <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', statusDotColor(file.status))} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
