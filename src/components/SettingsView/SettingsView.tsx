/**
 * SettingsView Component
 *
 * Modal overlay for application settings. Currently supports
 * configuring the comment nickname. Opens via Ctrl+, / Cmd+,
 * or from the Edit menu.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { X } from 'lucide-react'

interface SettingsViewProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const STORE_KEY = 'commentNickname'

export function SettingsView({ open, onOpenChange }: SettingsViewProps) {
  const [nickname, setNickname] = useState('')
  const [gitName, setGitName] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Load current values when opened
  useEffect(() => {
    if (!open) return

    window.electron.store.get(STORE_KEY).then((val: unknown) => {
      if (typeof val === 'string') setNickname(val)
    })

    window.electron.git.getConfig('user.name').then((name: string | null) => {
      setGitName(name)
    }).catch(() => {})

    // Focus input when opened
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  // Handle Escape to close
  useEffect(() => {
    if (!open) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onOpenChange(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onOpenChange])

  const handleSave = useCallback(async () => {
    await window.electron.store.set(STORE_KEY, nickname.trim())
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }, [nickname])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false)
      }}
    >
      <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-medium">Settings</h2>
          <button
            onClick={() => onOpenChange(false)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Comment nickname */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Comment nickname
            </label>
            <input
              ref={inputRef}
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={gitName || 'Anonymous'}
              className="w-full text-sm px-3 py-2 border border-border rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {gitName
                ? `Leave empty to use git name: ${gitName}`
                : 'Used as your author name in comments'}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          {saved && (
            <span className="text-xs text-green-600 dark:text-green-400">Saved</span>
          )}
          <button
            onClick={() => onOpenChange(false)}
            className="text-xs px-3 py-1.5 rounded border border-border hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
