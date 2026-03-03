/**
 * URL Input Dialog Component
 *
 * A simple modal dialog for entering a URL to import as markdown.
 * Triggered by the "Import from URL..." menu item or Ctrl+Shift+U.
 * Validates that the input looks like an HTTP(S) URL before accepting.
 *
 * Follows the same dialog pattern as NewItemDialog for consistency.
 */

import { useState, useEffect, useRef } from 'react'

interface UrlInputDialogProps {
  isOpen: boolean
  onSubmit: (url: string) => void
  onClose: () => void
}

export function UrlInputDialog({ isOpen, onSubmit, onClose }: UrlInputDialogProps) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setUrl('')
      setError(null)
      // Focus input after dialog opens
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const trimmed = url.trim()
    if (!trimmed) {
      setError('Please enter a URL')
      return
    }

    if (!/^https?:\/\/.+/i.test(trimmed)) {
      setError('Please enter a valid URL starting with http:// or https://')
      return
    }

    onSubmit(trimmed)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        className="bg-background border border-border rounded-lg shadow-lg p-4 w-96"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold mb-3">
          Import from URL
        </h3>
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="url"
            value={url}
            onChange={e => {
              setUrl(e.target.value)
              setError(null)
            }}
            placeholder="https://example.com/article"
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
              Import
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
