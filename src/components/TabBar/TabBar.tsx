/**
 * TabBar Component
 *
 * Displays a row of tabs for open files, similar to VS Code.
 * Supports tab switching, closing, and shows dirty state indicators.
 */

import { X, Plus, FileText, Image, Film, Braces, Code, File } from 'lucide-react'
import { cn } from '../../lib/utils'
import { FileType, getFileType } from '../../lib/fileTypes'

export interface Tab {
  id: string                    // Unique identifier (use file path or generate for untitled)
  filePath: string | null       // Null for untitled files
  title: string                 // Display name
  content: string               // Current content (for text files)
  binaryData?: string           // Base64 encoded data (for binary files like images/videos)
  savedContent: string          // Last saved content (to track dirty state)
  isDirty: boolean              // Has unsaved changes
  fileType: FileType            // Type of file (determines which viewer/editor to use)
}

interface TabBarProps {
  tabs: Tab[]
  activeTabId: string | null
  onTabClick: (tabId: string) => void
  onTabClose: (tabId: string) => void
  onNewTab?: () => void
}

/**
 * Returns the appropriate icon component for a file type.
 */
function getFileTypeIcon(fileType: FileType) {
  switch (fileType) {
    case 'markdown': return FileText
    case 'image': return Image
    case 'video': return Film
    case 'json': return Braces
    case 'html': return Code
    default: return File
  }
}

export function TabBar({ tabs, activeTabId, onTabClick, onTabClose, onNewTab }: TabBarProps) {
  if (tabs.length === 0 && !onNewTab) {
    return null
  }

  return (
    <div className="flex items-center bg-muted/30 border-b border-border overflow-x-auto">
      {tabs.map(tab => {
        const Icon = getFileTypeIcon(tab.fileType)
        return (
        <div
          key={tab.id}
          className={cn(
            'group flex items-center gap-2 px-3 py-1.5 border-r border-border cursor-pointer min-w-0',
            'hover:bg-accent/50 transition-colors',
            activeTabId === tab.id ? 'bg-background' : 'bg-muted/30'
          )}
          onClick={() => onTabClick(tab.id)}
        >
          <Icon className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
          <span className={cn(
            'text-sm truncate max-w-[120px]',
            tab.isDirty && 'italic'
          )}>
            {tab.title}
          </span>
          {tab.isDirty && (
            <span className="w-2 h-2 rounded-full bg-foreground flex-shrink-0" />
          )}
          <button
            className={cn(
              'p-0.5 rounded hover:bg-accent flex-shrink-0',
              'opacity-0 group-hover:opacity-100 transition-opacity',
              activeTabId === tab.id && 'opacity-100'
            )}
            onClick={(e) => {
              e.stopPropagation()
              onTabClose(tab.id)
            }}
            title="Close"
          >
            <X className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
          </button>
        </div>
      )})}
      {/* New Tab button */}
      {onNewTab && (
        <button
          onClick={onNewTab}
          className="flex items-center justify-center px-2 py-1.5 hover:bg-accent/50 transition-colors"
          title="New Tab (Ctrl+T)"
        >
          <Plus className="w-4 h-4 text-muted-foreground hover:text-foreground" />
        </button>
      )}
    </div>
  )
}

/**
 * Creates a new untitled tab.
 * Untitled tabs are always markdown (the default editor type).
 */
export function createUntitledTab(existingTabs: Tab[]): Tab {
  // Find the next untitled number
  const untitledNumbers = existingTabs
    .filter(t => t.title.startsWith('Untitled'))
    .map(t => {
      const match = t.title.match(/Untitled\s*(\d*)/)
      return match ? (parseInt(match[1]) || 1) : 1
    })

  const nextNumber = untitledNumbers.length === 0 ? 1 : Math.max(...untitledNumbers) + 1
  const title = nextNumber === 1 ? 'Untitled' : `Untitled ${nextNumber}`

  return {
    id: `untitled-${Date.now()}`,
    filePath: null,
    title,
    content: '',
    savedContent: '',
    isDirty: false,
    fileType: 'markdown'
  }
}

/**
 * Creates a tab for a text file.
 */
export function createFileTab(filePath: string, content: string): Tab {
  const fileName = filePath.split('/').pop() || filePath
  const fileType = getFileType(filePath)

  return {
    id: filePath,
    filePath,
    title: fileName,
    content,
    savedContent: content,
    isDirty: false,
    fileType
  }
}

/**
 * Creates a tab for a binary file (image, video).
 * Binary data is stored as base64.
 */
export function createBinaryFileTab(filePath: string, binaryData: string): Tab {
  const fileName = filePath.split('/').pop() || filePath
  const fileType = getFileType(filePath)

  return {
    id: filePath,
    filePath,
    title: fileName,
    content: '',
    binaryData,
    savedContent: '',
    isDirty: false,
    fileType
  }
}
