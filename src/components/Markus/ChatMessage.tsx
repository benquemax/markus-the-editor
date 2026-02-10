/**
 * ChatMessage Component
 *
 * Displays a single chat message with markdown rendering,
 * tool call displays, and status indicators.
 *
 * For the thought loop architecture:
 * - consult_boss tool calls are rendered as chat message bubbles
 * - All other tool calls are HIDDEN from the user (invisible)
 * - The user only sees consult_boss messages and blocking dialogs
 */

import { useState, useCallback } from 'react'
import { User, Bot, Copy, Check, Info, CheckCircle, AlertTriangle, XCircle, RefreshCw } from 'lucide-react'
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

/**
 * Renders a consult_boss message as a styled chat bubble.
 */
function ConsultBossMessage({ toolCall }: { toolCall: MarkusToolCallRecord }) {
  const args = toolCall.arguments as { message?: string; type?: string }
  const message = args.message || ''
  const type = (args.type || 'info') as 'info' | 'success' | 'warning' | 'error' | 'progress'

  const icons = {
    info: <Info className="w-4 h-4 text-blue-500" />,
    success: <CheckCircle className="w-4 h-4 text-green-500" />,
    warning: <AlertTriangle className="w-4 h-4 text-amber-500" />,
    error: <XCircle className="w-4 h-4 text-red-500" />,
    progress: <RefreshCw className="w-4 h-4 text-blue-500 animate-spin" />
  }

  const bgColors = {
    info: 'bg-blue-500/5 border-blue-500/20',
    success: 'bg-green-500/5 border-green-500/20',
    warning: 'bg-amber-500/5 border-amber-500/20',
    error: 'bg-red-500/5 border-red-500/20',
    progress: 'bg-blue-500/5 border-blue-500/20'
  }

  return (
    <div className={cn('p-3 rounded-lg border', bgColors[type])}>
      <div className="flex items-start gap-2">
        {icons[type]}
        <div
          className="flex-1 prose prose-sm max-w-none dark:prose-invert"
          dangerouslySetInnerHTML={{ __html: md.render(message) }}
        />
      </div>
    </div>
  )
}

interface ChatMessageProps {
  message: MarkusChatMessage
}

export function ChatMessage({ message }: ChatMessageProps) {
  const [copied, setCopied] = useState(false)
  const isUser = message.role === 'user'
  const isError = message.status === 'error'

  // Strip "[User Response] " prefix — used internally by the thought loop
  // but shouldn't be shown in the UI
  const displayContent = message.content?.replace(/^\[User Response\]\s*/, '') || ''

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
        {/* Main content bubble - only show for USER messages
            For assistant messages, content is invisible (only tool outputs shown) */}
        {isUser && displayContent.trim() && (
          <div
            className={cn(
              'inline-block p-3 rounded-lg text-sm',
              'bg-muted text-foreground',
              isError && 'bg-destructive/10 border border-destructive/30'
            )}
          >
            <div
              className="prose prose-sm max-w-none dark:prose-invert"
              dangerouslySetInnerHTML={{
                __html: md.render(displayContent)
              }}
            />
          </div>
        )}

        {/* Tool calls - ONLY show consult_boss messages, all others are hidden */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="space-y-2">
            {message.toolCalls.map((toolCall: MarkusToolCallRecord) => {
              // consult_boss: Render as a styled message bubble
              if (toolCall.name === 'consult_boss') {
                return <ConsultBossMessage key={toolCall.id} toolCall={toolCall} />
              }

              // All other tools: Hidden from user (only consult_boss is visible)
              // This includes: update_tasks, ask_user, request_task_approval,
              // read_file, list_directory, search_files, edit_file, consult_*_agent, etc.
              return null
            })}
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
