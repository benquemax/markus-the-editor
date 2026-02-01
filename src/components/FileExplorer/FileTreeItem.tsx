/**
 * File Tree Item Component
 *
 * Renders a single row in the file tree (file or folder).
 * Shows expand/collapse arrows for directories, file icons, and git status indicators.
 * For directories, shows new file/folder icons on hover.
 */

import { ChevronRight, ChevronDown, Folder, File, FileText, Loader2, FilePlus, FolderPlus, Image, Film, Braces, Code } from 'lucide-react'
import { cn } from '../../lib/utils'
import { FileTreeNode, GitStatus } from '../../lib/fileTree'
import { getFileType } from '../../lib/fileTypes'

interface FileTreeItemProps {
  node: FileTreeNode
  depth: number
  isSelected: boolean
  onSelect: (node: FileTreeNode) => void
  onToggleExpand: (node: FileTreeNode) => void
  onDoubleClick: (node: FileTreeNode) => void
  onNewFile?: (parentPath: string) => void
  onNewFolder?: (parentPath: string) => void
}

/**
 * Returns the appropriate icon for a file based on its type.
 */
function getFileIcon(filePath: string) {
  const fileType = getFileType(filePath)

  switch (fileType) {
    case 'markdown':
      return FileText
    case 'image':
      return Image
    case 'video':
      return Film
    case 'json':
      return Braces
    case 'html':
      return Code
    default:
      return File
  }
}

/**
 * Returns the CSS class for a git status.
 */
function getGitStatusClass(status: GitStatus): string {
  switch (status) {
    case 'modified':
      return 'text-yellow-500'
    case 'added':
      return 'text-green-500'
    case 'deleted':
      return 'text-red-500'
    case 'untracked':
      return 'text-muted-foreground'
    case 'renamed':
      return 'text-blue-500'
    default:
      return ''
  }
}

export function FileTreeItem({
  node,
  depth,
  isSelected,
  onSelect,
  onToggleExpand,
  onDoubleClick,
  onNewFile,
  onNewFolder
}: FileTreeItemProps) {
  const isDirectory = node.type === 'directory'
  const paddingLeft = depth * 12 + 4

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onSelect(node)

    // Single click opens files, toggles folders
    if (isDirectory) {
      onToggleExpand(node)
    } else {
      onDoubleClick(node)
    }
  }

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    // Double click also works (for consistency)
    if (isDirectory) {
      onToggleExpand(node)
    } else {
      onDoubleClick(node)
    }
  }

  const handleExpandClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onToggleExpand(node)
  }

  const handleNewFile = (e: React.MouseEvent) => {
    e.stopPropagation()
    onNewFile?.(node.path)
  }

  const handleNewFolder = (e: React.MouseEvent) => {
    e.stopPropagation()
    onNewFolder?.(node.path)
  }

  const FileIcon = isDirectory ? Folder : getFileIcon(node.path)
  const gitStatusClass = node.gitStatus ? getGitStatusClass(node.gitStatus) : ''

  return (
    <div
      className={cn(
        'group flex items-center gap-1 px-1 py-0.5 cursor-pointer hover:bg-accent text-sm select-none',
        isSelected && 'bg-accent'
      )}
      style={{ paddingLeft }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      data-selected={isSelected}
    >
      {/* Expand/collapse arrow for directories */}
      {isDirectory && (
        <button
          className="w-4 h-4 flex items-center justify-center hover:bg-accent rounded"
          onClick={handleExpandClick}
        >
          {node.isLoading ? (
            <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
          ) : node.isExpanded ? (
            <ChevronDown className="w-3 h-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-3 h-3 text-muted-foreground" />
          )}
        </button>
      )}

      {/* Spacer for files (to align with folders) */}
      {!isDirectory && <div className="w-4" />}

      {/* File/folder icon */}
      <FileIcon className={cn('w-4 h-4 flex-shrink-0', isDirectory ? 'text-muted-foreground' : 'text-muted-foreground')} />

      {/* File/folder name with git status color */}
      <span className={cn('truncate flex-1', gitStatusClass)}>
        {node.name}
      </span>

      {/* New file/folder buttons for directories (shown on hover) */}
      {isDirectory && (
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            className="p-0.5 hover:bg-accent rounded"
            onClick={handleNewFile}
            title="New File"
          >
            <FilePlus className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
          </button>
          <button
            className="p-0.5 hover:bg-accent rounded"
            onClick={handleNewFolder}
            title="New Folder"
          >
            <FolderPlus className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
          </button>
        </div>
      )}

      {/* Git status indicator dot */}
      {node.gitStatus && !isDirectory && (
        <span className={cn('w-1.5 h-1.5 rounded-full ml-auto flex-shrink-0', {
          'bg-yellow-500': node.gitStatus === 'modified',
          'bg-green-500': node.gitStatus === 'added',
          'bg-red-500': node.gitStatus === 'deleted',
          'bg-muted-foreground': node.gitStatus === 'untracked',
          'bg-blue-500': node.gitStatus === 'renamed'
        })} />
      )}
    </div>
  )
}
