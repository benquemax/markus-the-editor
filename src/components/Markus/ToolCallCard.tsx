/**
 * ToolCallCard Component
 *
 * Beautiful, semantic display for tool calls with icons, summaries,
 * and expandable details. Designed to be more intuitive than raw JSON.
 *
 * Features:
 * - Tool-specific icons and summaries
 * - Collapsible details section
 * - Approval buttons for pending tools
 * - Pretty-printed arguments and results
 */

import { useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Check,
  X,
  Loader2,
  AlertCircle,
  FileText,
  FolderOpen,
  Search,
  Globe,
  Brain,
  Settings,
  Edit3,
  Plus,
  Trash2,
  Database,
  Eye
} from 'lucide-react'
import type { MarkusToolCallRecord } from '../../lib/markus/types'
import { cn } from '../../lib/utils'
import path from 'path-browserify'

interface ToolCallCardProps {
  toolCall: MarkusToolCallRecord
  onApprove: () => void
  onReject: () => void
}

/**
 * Gets an icon for a tool based on its name.
 */
function getToolIcon(toolName: string) {
  switch (toolName) {
    case 'read_file':
      return Eye
    case 'create_file':
      return Plus
    case 'edit_file':
      return Edit3
    case 'delete_file':
      return Trash2
    case 'list_directory':
    case 'create_directory':
      return FolderOpen
    case 'search_files':
      return Search
    case 'search_web':
    case 'duck_ai':
      return Globe
    case 'update_memory':
      return Brain
    case 'get_open_files':
    case 'get_workspace_folders':
      return Settings
    case 'vector_search':
      return Database
    default:
      return FileText
  }
}

/**
 * Gets a human-readable summary for a tool call.
 */
function getToolSummary(toolCall: MarkusToolCallRecord): string {
  const args = toolCall.arguments
  switch (toolCall.name) {
    case 'read_file':
      return `Reading ${getFileName(args.path as string)}`
    case 'edit_file':
      return `Editing ${getFileName(args.path as string)}`
    case 'create_file':
      return `Creating ${getFileName(args.path as string)}`
    case 'delete_file':
      return `Deleting ${getFileName(args.path as string)}`
    case 'list_directory':
      return `Listing ${getDirName(args.path as string)}`
    case 'create_directory':
      return `Creating directory ${getDirName(args.path as string)}`
    case 'search_files':
      return `Searching for "${truncate(args.query as string, 30)}"`
    case 'search_web':
      return `Web search: "${truncate(args.query as string, 30)}"`
    case 'duck_ai':
      return `DuckDuckGo: "${truncate(args.query as string, 30)}"`
    case 'update_memory':
      return `Updating ${args.scope || 'memory'}`
    case 'get_open_files':
      return 'Getting open files'
    case 'get_workspace_folders':
      return 'Getting workspace folders'
    case 'vector_search':
      return `Semantic search: "${truncate(args.query as string, 30)}"`
    default:
      return toolCall.name.replace(/_/g, ' ')
  }
}

/**
 * Extract filename from path.
 */
function getFileName(filePath: string | undefined): string {
  if (!filePath) return 'file'
  return path.basename(filePath)
}

/**
 * Extract directory name from path.
 */
function getDirName(dirPath: string | undefined): string {
  if (!dirPath) return 'directory'
  const basename = path.basename(dirPath)
  return basename || dirPath
}

/**
 * Truncate string with ellipsis.
 */
function truncate(str: string | undefined, maxLen: number): string {
  if (!str) return ''
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen - 3) + '...'
}

/**
 * Gets the status color for a tool call.
 */
function getStatusClasses(status: MarkusToolCallRecord['status']): {
  bg: string
  text: string
  border: string
} {
  switch (status) {
    case 'pending':
      return { bg: 'bg-amber-500/10', text: 'text-amber-500', border: 'border-amber-500/30' }
    case 'approved':
    case 'executing':
      return { bg: 'bg-blue-500/10', text: 'text-blue-500', border: 'border-blue-500/30' }
    case 'complete':
      return { bg: 'bg-green-500/10', text: 'text-green-500', border: 'border-green-500/30' }
    case 'rejected':
    case 'error':
      return { bg: 'bg-red-500/10', text: 'text-red-500', border: 'border-red-500/30' }
    default:
      return { bg: 'bg-muted', text: 'text-muted-foreground', border: 'border-border' }
  }
}

/**
 * Format tool arguments for display.
 */
function ArgumentsDisplay({ args }: { args: Record<string, unknown> }) {
  const entries = Object.entries(args)

  if (entries.length === 0) {
    return <span className="text-xs text-muted-foreground italic">No arguments</span>
  }

  return (
    <div className="space-y-1">
      {entries.map(([key, value]) => (
        <div key={key} className="flex gap-2 text-xs">
          <span className="font-medium text-muted-foreground min-w-[80px]">{key}:</span>
          <span className="text-foreground break-all">
            {typeof value === 'string' ? value : JSON.stringify(value)}
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * Format tool result for display.
 */
function ResultPreview({ result }: { result: unknown }) {
  if (result === undefined || result === null) {
    return null
  }

  const stringResult = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
  const truncated = stringResult.length > 500 ? stringResult.slice(0, 500) + '...' : stringResult

  return (
    <pre className="text-xs bg-muted/50 p-2 rounded overflow-auto max-h-[200px] whitespace-pre-wrap thin-scrollbar">
      {truncated}
    </pre>
  )
}

export function ToolCallCard({ toolCall, onApprove, onReject }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false)
  const Icon = getToolIcon(toolCall.name)
  const summary = getToolSummary(toolCall)
  const statusClasses = getStatusClasses(toolCall.status)

  const isPending = toolCall.status === 'pending'
  const isExecuting = toolCall.status === 'executing'
  const isComplete = toolCall.status === 'complete'
  const isError = toolCall.status === 'error'
  const isRejected = toolCall.status === 'rejected'

  return (
    <div
      className={cn(
        'border rounded-lg overflow-hidden transition-all',
        statusClasses.border,
        statusClasses.bg
      )}
    >
      {/* Header - always visible */}
      <button
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2 text-left',
          'hover:bg-black/5 dark:hover:bg-white/5 transition-colors'
        )}
        onClick={() => setExpanded(!expanded)}
      >
        {/* Expand icon */}
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        )}

        {/* Tool icon */}
        <div className={cn('p-1 rounded', statusClasses.bg)}>
          <Icon className={cn('w-3.5 h-3.5', statusClasses.text)} />
        </div>

        {/* Summary */}
        <span className="text-sm font-medium flex-1 truncate">{summary}</span>

        {/* Status indicator */}
        <div className="flex items-center gap-1.5">
          {isExecuting && (
            <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
          )}
          {isComplete && (
            <Check className="w-4 h-4 text-green-500" />
          )}
          {(isError || isRejected) && (
            <AlertCircle className="w-4 h-4 text-red-500" />
          )}
          {isPending && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-600 dark:text-amber-400">
              Pending
            </span>
          )}
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-border/50">
          <div className="pt-2">
            {/* Arguments */}
            <div className="mb-3">
              <div className="text-xs font-medium text-muted-foreground mb-1.5">Arguments</div>
              <div className="bg-muted/30 rounded p-2">
                <ArgumentsDisplay args={toolCall.arguments} />
              </div>
            </div>

            {/* Result */}
            {toolCall.result !== undefined && (
              <div className="mb-3">
                <div className="text-xs font-medium text-muted-foreground mb-1.5">Result</div>
                <ResultPreview result={toolCall.result} />
              </div>
            )}

            {/* Error */}
            {toolCall.error && (
              <div className="flex items-start gap-2 p-2 bg-red-500/10 rounded text-red-600 dark:text-red-400">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span className="text-xs">{toolCall.error}</span>
              </div>
            )}

            {/* Execution time */}
            {toolCall.completedAt && (
              <div className="text-xs text-muted-foreground">
                Completed in {toolCall.completedAt - toolCall.startedAt}ms
              </div>
            )}

            {/* Raw JSON toggle */}
            <details className="mt-2">
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                Show raw JSON
              </summary>
              <pre className="mt-1 text-[10px] bg-muted p-2 rounded overflow-auto max-h-[150px] thin-scrollbar">
                {JSON.stringify(toolCall, null, 2)}
              </pre>
            </details>
          </div>
        </div>
      )}

      {/* Approval buttons (shown when pending) */}
      {isPending && (
        <div className="flex border-t border-border/50">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onApprove()
            }}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm text-green-600 dark:text-green-400 hover:bg-green-500/10 transition-colors"
          >
            <Check className="w-4 h-4" />
            Approve
          </button>
          <div className="w-px bg-border/50" />
          <button
            onClick={(e) => {
              e.stopPropagation()
              onReject()
            }}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <X className="w-4 h-4" />
            Reject
          </button>
        </div>
      )}
    </div>
  )
}
