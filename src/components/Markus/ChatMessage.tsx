/**
 * ChatMessage Component
 *
 * Displays a single chat message with markdown rendering,
 * tool call displays, and status indicators.
 */

import { useState, useCallback } from 'react'
import { User, Bot, Loader2, Copy, Check } from 'lucide-react'
import { ToolCallDisplay } from './ToolCallDisplay'
import type { MarkusChatMessage, MarkusToolCallRecord } from '../../lib/markus/types'
import { cn } from '../../lib/utils'
import MarkdownIt from 'markdown-it'

// Initialize markdown parser
const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: true
})

interface ChatMessageProps {
  message: MarkusChatMessage
  onToolApproval: (toolCallId: string, approved: boolean) => void
}

export function ChatMessage({ message, onToolApproval }: ChatMessageProps) {
  const [copied, setCopied] = useState(false)
  const isUser = message.role === 'user'
  const isStreaming = message.status === 'streaming'
  const isError = message.status === 'error'

  /**
   * Copies the message content to clipboard.
   */
  const handleCopy = useCallback(async () => {
    if (!message.content) return
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Silently fail
    }
  }, [message.content])

  return (
    <div
      className={cn(
        'flex gap-3 group',
        isUser && 'flex-row-reverse'
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted'
        )}
      >
        {isUser ? (
          <User className="w-4 h-4" />
        ) : (
          <Bot className="w-4 h-4" />
        )}
      </div>

      {/* Message content */}
      <div
        className={cn(
          'flex-1 max-w-[85%] space-y-2',
          isUser && 'text-right'
        )}
      >
        {/* Main content bubble */}
        <div
          className={cn(
            'inline-block p-3 rounded-lg text-sm',
            isUser
              ? 'bg-primary text-primary-foreground'
              : message.isPlan
                ? 'bg-amber-500/10 border border-amber-500/30'
                : 'bg-muted',
            isError && 'bg-destructive/10 border border-destructive/30'
          )}
        >
          {message.content ? (
            <div
              className={cn(
                'prose prose-sm max-w-none',
                isUser ? 'prose-invert' : 'dark:prose-invert'
              )}
              dangerouslySetInnerHTML={{
                __html: md.render(message.content)
              }}
            />
          ) : isStreaming ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : null}

          {/* Streaming indicator */}
          {isStreaming && message.content && (
            <span className="inline-block w-1.5 h-4 bg-current animate-pulse ml-1" />
          )}
        </div>

        {/* Tool calls */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="space-y-2">
            {message.toolCalls.map((toolCall: MarkusToolCallRecord) => (
              <ToolCallDisplay
                key={toolCall.id}
                toolCall={toolCall}
                onApprove={() => onToolApproval(toolCall.id, true)}
                onReject={() => onToolApproval(toolCall.id, false)}
              />
            ))}
          </div>
        )}

        {/* Error message */}
        {isError && message.error && (
          <div className="text-xs text-destructive mt-1">
            {message.error}
          </div>
        )}

        {/* Timestamp and copy button */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{new Date(message.timestamp).toLocaleTimeString()}</span>
          {message.content && (
            <button
              onClick={handleCopy}
              className={cn(
                'p-0.5 rounded hover:bg-accent transition-colors',
                'opacity-0 group-hover:opacity-100'
              )}
              title={copied ? 'Copied!' : 'Copy message'}
            >
              {copied ? (
                <Check className="w-3 h-3 text-green-500" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
