/**
 * Inline Create Input Component
 *
 * VS Code-style inline text input that appears inside the file tree
 * when creating a new file or folder. Replaces the modal dialog approach.
 */

import { useState, useRef, useEffect } from 'react'
import { File, Folder } from 'lucide-react'
import { cn } from '../../lib/utils'

interface InlineCreateInputProps {
  depth: number
  type: 'file' | 'folder'
  onSubmit: (name: string) => void
  onCancel: () => void
}

export function InlineCreateInput({ depth, type, onSubmit, onCancel }: InlineCreateInputProps) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-focus on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const validate = (value: string): string | null => {
    const trimmed = value.trim()
    if (!trimmed) return 'Name cannot be empty'
    if (/[<>:"/\\|?*]/.test(trimmed)) return 'Name contains invalid characters'
    return null
  }

  const handleSubmit = () => {
    const trimmed = name.trim()
    const validationError = validate(trimmed)
    if (validationError) {
      setError(validationError)
      return
    }
    onSubmit(trimmed)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }

  const handleBlur = () => {
    // Cancel on blur (clicking away)
    onCancel()
  }

  // Match FileTreeItem layout: depth * 12 + 4 base padding
  const paddingLeft = depth * 12 + 4
  const Icon = type === 'folder' ? Folder : File

  return (
    <div>
      <div
        className="flex items-center gap-1 px-1 py-0.5 text-sm"
        style={{ paddingLeft }}
      >
        {/* Spacer matching the chevron area */}
        <div className="w-4" />
        <Icon className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={e => {
            setName(e.target.value)
            setError(null)
          }}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={type === 'file' ? 'filename.md' : 'folder-name'}
          className={cn(
            'flex-1 min-w-0 px-1 py-0 text-sm bg-background border rounded',
            'focus:outline-none focus:ring-1 focus:ring-ring',
            error ? 'border-destructive' : 'border-input'
          )}
        />
      </div>
      {error && (
        <div
          className="text-xs text-destructive px-1 pb-0.5"
          style={{ paddingLeft: paddingLeft + 20 + 4 }}
        >
          {error}
        </div>
      )}
    </div>
  )
}
