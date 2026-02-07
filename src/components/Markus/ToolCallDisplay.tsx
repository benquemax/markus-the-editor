/**
 * ToolCallDisplay Component
 *
 * Displays a tool call with its arguments, status, and result.
 * Shows approval buttons when the tool is pending approval.
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
  Settings
} from 'lucide-react'
import type { MarkusToolCallRecord } from '../../lib/markus/types'
import { cn } from '../../lib/utils'

interface ToolCallDisplayProps {
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
    case 'create_file':
    case 'edit_file':
    case 'delete_file':
      return FileText
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
    default:
      return Settings
  }
}

/**
 * Gets a human-readable label for a tool.
 */
function getToolLabel(toolName: string): string {
  const labels: Record<string, string> = {
    'read_file': 'Read File',
    'list_directory': 'List Directory',
    'edit_file': 'Edit File',
    'create_file': 'Create File',
    'delete_file': 'Delete File',
    'create_directory': 'Create Directory',
    'search_files': 'Search Files',
    'search_web': 'Web Search',
    'duck_ai': 'DuckDuckGo AI',
    'get_open_files': 'Get Open Files',
    'get_workspace_folders': 'Get Workspace Folders',
    'update_memory': 'Update Memory'
  }
  return labels[toolName] || toolName
}

/**
 * Gets the status color for a tool call.
 */
function getStatusColor(status: MarkusToolCallRecord['status']): string {
  switch (status) {
    case 'pending':
      return 'text-amber-500'
    case 'approved':
    case 'executing':
      return 'text-blue-500'
    case 'complete':
      return 'text-green-500'
    case 'rejected':
    case 'error':
      return 'text-red-500'
    default:
      return 'text-muted-foreground'
  }
}

export function ToolCallDisplay({ toolCall, onApprove, onReject }: ToolCallDisplayProps) {
  const [expanded, setExpanded] = useState(false)
  const Icon = getToolIcon(toolCall.name)
  const isPending = toolCall.status === 'pending'
  const isExecuting = toolCall.status === 'executing'
  const isComplete = toolCall.status === 'complete'
  const isError = toolCall.status === 'error'
  const isRejected = toolCall.status === 'rejected'

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-background">
      {/* Header */}
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/50',
          expanded && 'border-b border-border'
        )}
        onClick={() => setExpanded(!expanded)}
      >
        {/* Expand/collapse icon */}
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        )}

        {/* Tool icon */}
        <Icon className={cn('w-4 h-4', getStatusColor(toolCall.status))} />

        {/* Tool name */}
        <span className="text-sm font-medium flex-1">
          {getToolLabel(toolCall.name)}
        </span>

        {/* Status indicator */}
        {isExecuting && (
          <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
        )}
        {isComplete && (
          <Check className="w-4 h-4 text-green-500" />
        )}
        {(isError || isRejected) && (
          <X className="w-4 h-4 text-red-500" />
        )}
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="p-3 space-y-3 text-sm">
          {/* Arguments */}
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1">
              Arguments
            </div>
            <pre className="bg-muted p-2 rounded text-xs overflow-auto max-h-[150px] thin-scrollbar">
              {JSON.stringify(toolCall.arguments, null, 2)}
            </pre>
          </div>

          {/* Result */}
          {toolCall.result !== undefined && (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">
                Result
              </div>
              <pre className="bg-muted p-2 rounded text-xs overflow-auto max-h-[200px] thin-scrollbar">
                {typeof toolCall.result === 'string'
                  ? toolCall.result
                  : JSON.stringify(toolCall.result, null, 2)}
              </pre>
            </div>
          )}

          {/* Error */}
          {toolCall.error && (
            <div className="flex items-start gap-2 text-destructive">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span className="text-xs">{toolCall.error}</span>
            </div>
          )}

          {/* Execution time */}
          {toolCall.completedAt && (
            <div className="text-xs text-muted-foreground">
              Executed in {toolCall.completedAt - toolCall.startedAt}ms
            </div>
          )}
        </div>
      )}

      {/* Approval buttons (shown when pending) */}
      {isPending && (
        <div className="flex border-t border-border">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onApprove()
            }}
            className="flex-1 flex items-center justify-center gap-1 py-2 text-sm text-green-600 hover:bg-green-500/10 transition-colors"
          >
            <Check className="w-4 h-4" />
            Approve
          </button>
          <div className="w-px bg-border" />
          <button
            onClick={(e) => {
              e.stopPropagation()
              onReject()
            }}
            className="flex-1 flex items-center justify-center gap-1 py-2 text-sm text-red-600 hover:bg-red-500/10 transition-colors"
          >
            <X className="w-4 h-4" />
            Reject
          </button>
        </div>
      )}
    </div>
  )
}
