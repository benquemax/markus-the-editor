/**
 * RAGStatus Component
 *
 * Shows the status of the RAG (Retrieval-Augmented Generation) index.
 * Displays indexing progress and chunk counts.
 */

import { Database, Loader2, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react'
import type { RAGIndexStatus } from '../../lib/markus/types'

interface RAGStatusProps {
  /** Index status */
  status: RAGIndexStatus
  /** Callback to trigger reindex */
  onReindex?: () => void
  /** Compact display mode */
  compact?: boolean
}

export function RAGStatus({ status, onReindex, compact }: RAGStatusProps) {
  const { indexing, totalFiles, indexedFiles, totalChunks, lastUpdated, error } = status

  // Calculate progress percentage
  const progress = totalFiles > 0 ? Math.round((indexedFiles / totalFiles) * 100) : 0

  // Format last updated time
  const formatTime = (timestamp: number | null) => {
    if (!timestamp) return 'Never'
    const diff = Date.now() - timestamp
    if (diff < 60000) return 'Just now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    return `${Math.floor(diff / 3600000)}h ago`
  }

  if (compact) {
    return (
      <div
        className={`
          flex items-center gap-1.5 px-2 py-1 rounded text-xs
          ${error ? 'text-red-500' : indexing ? 'text-amber-500' : 'text-muted-foreground'}
        `}
        title={`RAG Index: ${totalChunks} chunks${error ? ` - Error: ${error}` : ''}`}
      >
        {error ? (
          <AlertCircle className="w-3.5 h-3.5" />
        ) : indexing ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Database className="w-3.5 h-3.5" />
        )}
        <span>{totalChunks}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 p-3 bg-muted/30 rounded-lg border border-border/50">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {error ? (
            <AlertCircle className="w-4 h-4 text-red-500" />
          ) : indexing ? (
            <Loader2 className="w-4 h-4 text-amber-500 animate-spin" />
          ) : totalChunks > 0 ? (
            <CheckCircle className="w-4 h-4 text-green-500" />
          ) : (
            <Database className="w-4 h-4 text-muted-foreground" />
          )}
          <span className="text-sm font-medium">RAG Index</span>
        </div>

        {onReindex && !indexing && (
          <button
            onClick={onReindex}
            className="p-1 hover:bg-accent rounded"
            title="Reindex workspace"
          >
            <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        )}
      </div>

      {indexing ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Indexing...</span>
            <span>{progress}%</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="text-xs text-muted-foreground">
            {indexedFiles} / {totalFiles} files
          </div>
        </div>
      ) : error ? (
        <div className="text-xs text-red-500">{error}</div>
      ) : (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{totalChunks} chunks indexed</span>
          <span>Updated {formatTime(lastUpdated)}</span>
        </div>
      )}
    </div>
  )
}
