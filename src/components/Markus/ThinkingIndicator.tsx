/**
 * ThinkingIndicator Component
 *
 * Shows a pulsing indicator when agents are thinking/working.
 * Provides visual feedback that work is in progress.
 */

import { Loader2, Brain, Sparkles } from 'lucide-react'

interface ThinkingIndicatorProps {
  /** Whether currently thinking */
  isThinking: boolean
  /** Current iteration number */
  iteration?: number
  /** Maximum iterations */
  maxIterations?: number
  /** Current agent working */
  agent?: string
  /** Compact mode */
  compact?: boolean
}

export function ThinkingIndicator({
  isThinking,
  iteration,
  maxIterations,
  agent,
  compact = false
}: ThinkingIndicatorProps) {
  if (!isThinking) return null

  if (compact) {
    return (
      <div className="flex items-center gap-1.5 text-amber-500">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        <span className="text-xs">Thinking...</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg animate-pulse">
      <div className="flex items-center gap-2">
        <div className="relative">
          <Brain className="w-5 h-5 text-amber-500" />
          <Sparkles className="w-3 h-3 text-amber-400 absolute -top-1 -right-1 animate-ping" />
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-medium text-amber-600 dark:text-amber-400">
            {agent ? `${agent} is thinking...` : 'Thinking...'}
          </span>
          {iteration !== undefined && maxIterations !== undefined && (
            <span className="text-xs text-amber-500/70">
              Iteration {iteration} / {maxIterations}
            </span>
          )}
        </div>
      </div>
      <Loader2 className="w-4 h-4 animate-spin text-amber-500 ml-auto" />
    </div>
  )
}
