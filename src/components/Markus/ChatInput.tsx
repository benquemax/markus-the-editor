/**
 * ChatInput Component
 *
 * Text input for sending messages to Markus, with controls for
 * planning mode and YOLO mode toggles.
 */

import { useState, useCallback, KeyboardEvent } from 'react'
import { Send, Square, Zap, ClipboardList } from 'lucide-react'
import { cn } from '../../lib/utils'

interface ChatInputProps {
  onSend: (message: string) => void
  onCancel: () => void
  isLoading: boolean
  planningMode: boolean
  yoloMode: boolean
  onPlanningModeChange: (enabled: boolean) => void
  onYoloModeChange: (enabled: boolean) => void
}

export function ChatInput({
  onSend,
  onCancel,
  isLoading,
  planningMode,
  yoloMode,
  onPlanningModeChange,
  onYoloModeChange
}: ChatInputProps) {
  const [message, setMessage] = useState('')

  const handleSend = useCallback(() => {
    if (message.trim() && !isLoading) {
      onSend(message)
      setMessage('')
    }
  }, [message, isLoading, onSend])

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  return (
    <div className="border-t border-border p-3 space-y-2">
      {/* Mode toggles */}
      <div className="flex items-center gap-3 text-xs">
        <button
          onClick={() => onPlanningModeChange(!planningMode)}
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded transition-colors',
            planningMode
              ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
              : 'text-muted-foreground hover:bg-muted'
          )}
          title="Planning mode: Markus will ask for approval before executing tools"
        >
          <ClipboardList className="w-3 h-3" />
          Plan
        </button>

        <button
          onClick={() => onYoloModeChange(!yoloMode)}
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded transition-colors',
            yoloMode
              ? 'bg-red-500/20 text-red-600 dark:text-red-400'
              : 'text-muted-foreground hover:bg-muted'
          )}
          title="YOLO mode: Execute all tools without approval (use with caution!)"
        >
          <Zap className="w-3 h-3" />
          YOLO
        </button>
      </div>

      {/* Input area */}
      <div className="flex gap-2">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask Markus anything..."
          className={cn(
            'flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
            'placeholder:text-muted-foreground',
            'min-h-[60px] max-h-[200px]'
          )}
          disabled={isLoading}
          rows={2}
        />

        {isLoading ? (
          <button
            onClick={onCancel}
            className={cn(
              'self-end px-3 py-2 rounded-lg',
              'bg-destructive text-destructive-foreground',
              'hover:bg-destructive/90 transition-colors'
            )}
            title="Stop generation"
          >
            <Square className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!message.trim()}
            className={cn(
              'self-end px-3 py-2 rounded-lg',
              'bg-primary text-primary-foreground',
              'hover:bg-primary/90 transition-colors',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
            title="Send message"
          >
            <Send className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Status indicator */}
      {isLoading && (
        <div className="text-xs text-muted-foreground">
          Markus is thinking...
        </div>
      )}
    </div>
  )
}
