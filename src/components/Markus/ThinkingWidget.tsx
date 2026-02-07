/**
 * ThinkingWidget Component
 *
 * Compact indicator shown while the agent is thinking/streaming.
 * Shows a "Thinking..." message with a marquee-style preview of the
 * last streamed text. Expandable to see the full raw response.
 */

import { useState, useEffect, useRef } from 'react'
import { Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '../../lib/utils'

interface ThinkingWidgetProps {
  streamingContent: string
  isThinking: boolean
  className?: string
}

/**
 * Extracts the last meaningful line from streaming content.
 * Skips empty lines and JSON blocks.
 */
function getLastLine(content: string): string {
  if (!content) return ''

  // Remove JSON blocks (tool calls)
  let cleaned = content.replace(/```(?:json)?\s*\n?\s*\{[\s\S]*?```/g, '')
  cleaned = cleaned.replace(/\{[\s\S]*?"tool"\s*:[\s\S]*?\}/g, '')

  // Get lines and find last non-empty one
  const lines = cleaned.split('\n').filter(line => line.trim())
  const lastLine = lines[lines.length - 1] || ''

  // Truncate if too long
  if (lastLine.length > 80) {
    return lastLine.substring(0, 77) + '...'
  }
  return lastLine
}

export function ThinkingWidget({ streamingContent, isThinking, className }: ThinkingWidgetProps) {
  // Previous iterations start collapsed, current iteration starts collapsed too
  const [isExpanded, setIsExpanded] = useState(false)
  const contentRef = useRef<HTMLPreElement>(null)
  const lastLine = getLastLine(streamingContent)

  // Auto-scroll to bottom when content changes in expanded mode
  useEffect(() => {
    if (isExpanded && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  }, [streamingContent, isExpanded])

  // Don't render if there's no content at all
  if (!streamingContent) return null

  return (
    <div className={cn(
      'rounded-lg border overflow-hidden',
      isThinking ? 'border-border/50 bg-muted/30' : 'border-border/30 bg-muted/20 opacity-60',
      className
    )}>
      {/* Compact header - always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/50 transition-colors"
      >
        {isThinking ? (
          <Loader2 className="w-4 h-4 animate-spin text-blue-500 flex-shrink-0" />
        ) : (
          <div className="w-4 h-4 rounded-full bg-muted-foreground/30 flex-shrink-0" />
        )}
        <span className="text-sm font-medium text-muted-foreground">
          {isThinking ? 'Thinking' : 'Thought'}
        </span>

        {/* Marquee-style last line preview */}
        {lastLine && !isExpanded && (
          <span className="flex-1 text-xs text-muted-foreground/70 truncate text-left mx-2 font-mono">
            {lastLine}
          </span>
        )}

        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        )}
      </button>

      {/* Expanded raw content */}
      {isExpanded && (
        <pre
          ref={contentRef}
          className="px-3 py-2 text-xs font-mono whitespace-pre-wrap break-words max-h-48 overflow-y-auto border-t border-border/30 bg-background/50"
        >
          {streamingContent || '...'}
        </pre>
      )}
    </div>
  )
}
