/**
 * Conflict Banner Component
 *
 * Displays a warning banner at the top of the editor when the local file
 * is behind the remote. Provides a simple "Pull updates" button for writers
 * who may not be familiar with Git terminology.
 */

import { AlertTriangle, Download, Loader2 } from 'lucide-react'

interface ConflictBannerProps {
  behind: number
  onPull: () => void
  isPulling: boolean
}

export function ConflictBanner({ behind, onPull, isPulling }: ConflictBannerProps) {
  if (behind <= 0) return null

  return (
    <div className="conflict-banner flex items-center justify-between px-4 py-2 bg-yellow-100 dark:bg-yellow-900/30 border-b border-yellow-300 dark:border-yellow-700 text-yellow-800 dark:text-yellow-200">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4" />
        <span className="text-sm">
          Updates available — your file is {behind} {behind === 1 ? 'version' : 'versions'} behind
        </span>
      </div>
      <button
        onClick={onPull}
        disabled={isPulling}
        className="flex items-center gap-1.5 px-3 py-1 bg-yellow-200 dark:bg-yellow-800 hover:bg-yellow-300 dark:hover:bg-yellow-700 rounded text-sm font-medium disabled:opacity-50 transition-colors"
      >
        {isPulling ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Pulling...
          </>
        ) : (
          <>
            <Download className="w-3.5 h-3.5" />
            Pull updates
          </>
        )}
      </button>
    </div>
  )
}
