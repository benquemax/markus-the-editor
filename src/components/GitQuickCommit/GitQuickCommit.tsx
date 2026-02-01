/**
 * Git Quick Commit Component
 *
 * Provides a VS Code-like interface for quick commits and pushes.
 * Shows at the top of the sidebar with a commit message field and
 * buttons for "Save locally" (commit) and "Upload changes" (push).
 */

import { useState, useCallback } from 'react'
import { GitBranch, Upload, Save, Loader2, AlertCircle } from 'lucide-react'
import { cn } from '../../lib/utils'

interface GitQuickCommitProps {
  isGitRepo: boolean
  onConflict: (content: string) => void
}

export function GitQuickCommit({ isGitRepo, onConflict }: GitQuickCommitProps) {
  const [message, setMessage] = useState('')
  const [isCommitting, setIsCommitting] = useState(false)
  const [isPushing, setIsPushing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  /**
   * Handles the "Save locally" button - stages all changes and commits.
   */
  const handleCommit = useCallback(async () => {
    if (!message.trim()) {
      setError('Please enter a commit message')
      return
    }

    setIsCommitting(true)
    setError(null)
    setStatusMessage(null)

    try {
      // Stage all changes
      const addResult = await window.electron.git.addAll()
      if (!addResult.success) {
        setError(addResult.error || 'Failed to stage changes')
        return
      }

      // Commit
      const commitResult = await window.electron.git.commit(message.trim())
      if (!commitResult.success) {
        setError(commitResult.error || 'Failed to commit')
        return
      }

      setMessage('')
      setStatusMessage('Changes saved locally')
      setTimeout(() => setStatusMessage(null), 3000)
    } catch (err) {
      setError(String(err))
    } finally {
      setIsCommitting(false)
    }
  }, [message])

  /**
   * Handles the "Upload changes" button - commits if needed, then pushes.
   * If push fails due to remote changes, handles stash/pull/pop flow.
   */
  const handlePush = useCallback(async () => {
    setIsPushing(true)
    setError(null)
    setStatusMessage(null)

    try {
      // If there's a message, commit first
      if (message.trim()) {
        const addResult = await window.electron.git.addAll()
        if (!addResult.success) {
          setError(addResult.error || 'Failed to stage changes')
          return
        }

        const commitResult = await window.electron.git.commit(message.trim())
        if (!commitResult.success) {
          setError(commitResult.error || 'Failed to commit')
          return
        }
        setMessage('')
      }

      // Push with conflict handling
      const pushResult = await window.electron.git.pushWithConflictHandling()

      if (!pushResult.success) {
        setError(pushResult.error || 'Failed to push')
        return
      }

      if (pushResult.hasConflicts && pushResult.content) {
        // Trigger conflict resolution
        onConflict(pushResult.content)
        return
      }

      setStatusMessage('Changes uploaded successfully')
      setTimeout(() => setStatusMessage(null), 3000)
    } catch (err) {
      setError(String(err))
    } finally {
      setIsPushing(false)
    }
  }, [message, onConflict])

  // Don't show if not in a git repo
  if (!isGitRepo) {
    return null
  }

  const isLoading = isCommitting || isPushing

  return (
    <div className="border-b border-border bg-muted/30">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <GitBranch className="w-4 h-4 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Source Control
        </span>
      </div>

      {/* Content */}
      <div className="p-3 space-y-2">
        {/* Commit message input */}
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Change summary"
          disabled={isLoading}
          className={cn(
            'w-full px-2 py-1.5 text-sm rounded border border-border',
            'bg-background placeholder:text-muted-foreground',
            'focus:outline-none focus:ring-1 focus:ring-ring',
            'disabled:opacity-50'
          )}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleCommit()
            }
          }}
        />

        {/* Buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleCommit}
            disabled={isLoading || !message.trim()}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-sm rounded',
              'bg-secondary text-secondary-foreground',
              'hover:bg-secondary/80 transition-colors',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
            title="Stage all changes and commit locally (git add -A && git commit)"
          >
            {isCommitting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            Save
          </button>

          <button
            onClick={handlePush}
            disabled={isLoading}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-sm rounded',
              'bg-primary text-primary-foreground',
              'hover:bg-primary/90 transition-colors',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
            title="Commit and push to remote (handles conflicts automatically)"
          >
            {isPushing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Upload className="w-3.5 h-3.5" />
            )}
            Sync
          </button>
        </div>

        {/* Error message */}
        {error && (
          <div className="flex items-start gap-2 text-xs text-destructive">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Status message */}
        {statusMessage && (
          <div className="text-xs text-green-600 dark:text-green-400">
            {statusMessage}
          </div>
        )}
      </div>
    </div>
  )
}
