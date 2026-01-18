import { useEffect, useState, useCallback } from 'react'
import { X, GitBranch, GitCommit, ArrowDown, ArrowUp, RefreshCw } from 'lucide-react'
import { cn } from '../lib/utils'

interface GitStatus {
  current: string | null
  tracking: string | null
  files: Array<{ path: string; index: string; working_dir: string }>
  ahead: number
  behind: number
}

interface GitBranches {
  all: string[]
  current: string
}

interface GitPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function GitPanel({ open, onOpenChange }: GitPanelProps) {
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [branches, setBranches] = useState<GitBranches | null>(null)
  const [commitMessage, setCommitMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const [statusResult, branchesResult] = await Promise.all([
        window.electron.git.status(),
        window.electron.git.branches()
      ])
      setStatus(statusResult)
      setBranches(branchesResult)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      refresh()
    }
  }, [open, refresh])

  const handlePull = async () => {
    try {
      setLoading(true)
      const result = await window.electron.git.pull()
      if (!result.success) {
        setError(result.error || 'Pull failed')
      } else {
        await refresh()
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  const handleCommit = async () => {
    if (!commitMessage.trim()) return

    try {
      setLoading(true)

      // Stage all changed files
      if (status?.files) {
        const filesToAdd = status.files
          .filter(f => f.working_dir !== ' ')
          .map(f => f.path)
        if (filesToAdd.length > 0) {
          await window.electron.git.add(filesToAdd)
        }
      }

      const result = await window.electron.git.commit(commitMessage)
      if (!result.success) {
        setError(result.error || 'Commit failed')
      } else {
        setCommitMessage('')
        await refresh()
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  const handlePush = async () => {
    try {
      setLoading(true)
      const result = await window.electron.git.push()
      if (!result.success) {
        setError(result.error || 'Push failed')
      } else {
        await refresh()
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  const handleCheckout = async (branch: string) => {
    try {
      setLoading(true)
      const result = await window.electron.git.checkout(branch)
      if (!result.success) {
        setError(result.error || 'Checkout failed')
      } else {
        await refresh()
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={() => onOpenChange(false)}
    >
      <div className="fixed inset-0 bg-background/80 backdrop-blur-sm" />
      <div
        className="relative bg-popover border border-border rounded-lg shadow-lg w-full max-w-md overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4" />
            <span className="font-medium">Git</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={refresh}
              disabled={loading}
              className="p-1 hover:bg-muted rounded"
            >
              <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            </button>
            <button
              onClick={() => onOpenChange(false)}
              className="p-1 hover:bg-muted rounded"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {error && (
            <div className="p-2 bg-destructive/10 text-destructive text-sm rounded">
              {error}
            </div>
          )}

          {/* Branch info */}
          {status && (
            <div className="space-y-2">
              <div className="text-sm">
                <span className="text-muted-foreground">Branch: </span>
                <span className="font-medium">{status.current}</span>
              </div>
              {status.tracking && (
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  {status.ahead > 0 && (
                    <span className="flex items-center gap-1">
                      <ArrowUp className="w-3 h-3" />
                      {status.ahead} ahead
                    </span>
                  )}
                  {status.behind > 0 && (
                    <span className="flex items-center gap-1">
                      <ArrowDown className="w-3 h-3" />
                      {status.behind} behind
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Changed files */}
          {status?.files && status.files.length > 0 && (
            <div className="space-y-2">
              <div className="text-sm font-medium">Changes</div>
              <div className="max-h-32 overflow-y-auto space-y-1">
                {status.files.map(file => (
                  <div
                    key={file.path}
                    className="text-sm flex items-center gap-2"
                  >
                    <span className={cn(
                      'w-4 text-center',
                      file.index === 'M' && 'text-yellow-500',
                      file.index === 'A' && 'text-green-500',
                      file.index === 'D' && 'text-red-500',
                      file.working_dir === '?' && 'text-muted-foreground'
                    )}>
                      {file.working_dir !== ' ' ? file.working_dir : file.index}
                    </span>
                    <span className="truncate">{file.path}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Commit form */}
          <div className="space-y-2">
            <input
              type="text"
              value={commitMessage}
              onChange={e => setCommitMessage(e.target.value)}
              placeholder="Commit message..."
              className="w-full px-3 py-2 bg-muted rounded text-sm outline-none"
            />
            <div className="flex gap-2">
              <button
                onClick={handleCommit}
                disabled={loading || !commitMessage.trim()}
                className="flex-1 px-3 py-2 bg-primary text-primary-foreground rounded text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <GitCommit className="w-4 h-4" />
                Commit
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={handlePull}
              disabled={loading}
              className="flex-1 px-3 py-2 bg-muted hover:bg-muted/80 rounded text-sm font-medium flex items-center justify-center gap-2"
            >
              <ArrowDown className="w-4 h-4" />
              Pull
            </button>
            <button
              onClick={handlePush}
              disabled={loading || (status?.ahead ?? 0) === 0}
              className="flex-1 px-3 py-2 bg-muted hover:bg-muted/80 rounded text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <ArrowUp className="w-4 h-4" />
              Push
            </button>
          </div>

          {/* Branch switcher */}
          {branches && branches.all.length > 1 && (
            <div className="space-y-2">
              <div className="text-sm font-medium">Switch Branch</div>
              <div className="flex flex-wrap gap-1">
                {branches.all.map(branch => (
                  <button
                    key={branch}
                    onClick={() => handleCheckout(branch)}
                    disabled={loading || branch === branches.current}
                    className={cn(
                      'px-2 py-1 text-xs rounded',
                      branch === branches.current
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted hover:bg-muted/80'
                    )}
                  >
                    {branch}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
