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

import { useState, useCallback, type ReactNode } from 'react'
import { User, Bot, Copy, Check, Info, CheckCircle, AlertTriangle, XCircle, RefreshCw, ChevronDown, ChevronUp, Terminal, FileText, FileEdit, Search, FolderOpen, Zap } from 'lucide-react'
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

/**
 * Returns a human-readable summary of the most relevant argument for a tool call.
 */
function getToolSummary(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'Bash': return String(args.command || '').slice(0, 60)
    case 'Read': return String(args.file_path || '').slice(0, 60)
    case 'Write': return String(args.file_path || '').slice(0, 60)
    case 'Edit': return String(args.file_path || '').slice(0, 60)
    case 'Glob': return String(args.pattern || '').slice(0, 60)
    case 'Grep': return String(args.pattern || '').slice(0, 60)
    case 'LS': return String(args.path || '.').slice(0, 60)
    case 'Task': return String(args.description || '').slice(0, 60)
    default: return ''
  }
}

const TOOL_ICONS: Record<string, ReactNode> = {
  Bash: <Terminal className="w-3 h-3" />,
  Read: <FileText className="w-3 h-3" />,
  Write: <FileEdit className="w-3 h-3" />,
  Edit: <FileEdit className="w-3 h-3" />,
  Glob: <Search className="w-3 h-3" />,
  Grep: <Search className="w-3 h-3" />,
  LS: <FolderOpen className="w-3 h-3" />,
  Task: <Zap className="w-3 h-3" />,
}

/**
 * Collapsible list of SDK tool calls (Bash, Read, Write, etc.) used during an agency response.
 * Collapsed by default to keep the chat clean; expandable for debugging.
 */
function AgencyToolsList({ toolCalls }: { toolCalls: MarkusToolCallRecord[] }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const agencyTools = toolCalls.filter(tc => tc.name !== 'consult_boss')
  if (agencyTools.length === 0) return null

  return (
    <div className="rounded border border-border/30 bg-muted/20 overflow-hidden text-xs">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-muted/40 transition-colors text-muted-foreground"
      >
        {isExpanded ? <ChevronUp className="w-3 h-3 flex-shrink-0" /> : <ChevronDown className="w-3 h-3 flex-shrink-0" />}
        <span>{agencyTools.length} tool{agencyTools.length !== 1 ? 's' : ''} used</span>
      </button>
      {isExpanded && (
        <div className="border-t border-border/30 divide-y divide-border/20">
          {agencyTools.map((tc) => {
            const summary = getToolSummary(tc.name, (tc.arguments as Record<string, unknown>) || {})
            const icon = TOOL_ICONS[tc.name] || <Zap className="w-3 h-3" />
            return (
              <div key={tc.id} className="flex items-start gap-2 px-2 py-1.5 text-muted-foreground">
                <span className="flex-shrink-0 mt-0.5 text-muted-foreground/70">{icon}</span>
                <span className="font-medium flex-shrink-0">{tc.name}</span>
                {summary && <span className="truncate text-muted-foreground/70 font-mono">{summary}</span>}
              </div>
            )
          })}
        </div>
      )}
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
        {/* Main content bubble */}
        {displayContent.trim() && (
          <div
            className={cn(
              'inline-block p-3 rounded-lg text-sm',
              isUser
                ? 'bg-muted text-foreground'
                : 'bg-card text-card-foreground border border-border/50',
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

        {/* Tool calls */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="space-y-2">
            {/* consult_boss: Render as styled message bubbles */}
            {message.toolCalls
              .filter((tc: MarkusToolCallRecord) => tc.name === 'consult_boss')
              .map((toolCall: MarkusToolCallRecord) => (
                <ConsultBossMessage key={toolCall.id} toolCall={toolCall} />
              ))}

            {/* Agency SDK tools (Bash, Read, Write, etc.): Collapsible list */}
            <AgencyToolsList toolCalls={message.toolCalls} />
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
