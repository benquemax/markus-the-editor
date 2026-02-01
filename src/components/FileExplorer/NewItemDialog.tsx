/**
 * New Item Dialog Component
 *
 * A simple dialog for entering a name when creating a new file or folder.
 */

import { useState, useEffect, useRef } from 'react'

interface NewItemDialogProps {
  isOpen: boolean
  type: 'file' | 'folder'
  parentPath: string
  onClose: () => void
  onCreate: (name: string) => void
}

export function NewItemDialog({ isOpen, type, parentPath, onClose, onCreate }: NewItemDialogProps) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setName('')
      setError(null)
      // Focus input after dialog opens
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('Name cannot be empty')
      return
    }

    // Basic validation for invalid characters
    if (/[<>:"/\\|?*]/.test(trimmedName)) {
      setError('Name contains invalid characters')
      return
    }

    onCreate(trimmedName)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    }
  }

  const parentName = parentPath.split('/').pop() || parentPath

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        className="bg-background border border-border rounded-lg shadow-lg p-4 w-80"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold mb-2">
          New {type === 'file' ? 'File' : 'Folder'}
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          in {parentName}/
        </p>
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={e => {
              setName(e.target.value)
              setError(null)
            }}
            placeholder={type === 'file' ? 'filename.md' : 'folder-name'}
            className="w-full px-3 py-2 text-sm border border-input rounded bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {error && (
            <p className="text-xs text-destructive mt-1">{error}</p>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm rounded hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
