/**
 * TaskListPanel Component
 *
 * Collapsible panel displaying the current task list for a conversation.
 * Shows below the conversation header and provides a persistent view
 * of what the agent is working on. Updates in real-time as tasks change.
 */

import { useState, useEffect } from 'react'
import { ChevronDown, ChevronRight, CheckCircle2, Circle, Clock, AlertCircle } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { Task } from '../../lib/markus/types'

interface TaskListPanelProps {
  tasks: Task[]
  className?: string
}

/**
 * Gets the appropriate icon for a task status.
 */
function TaskStatusIcon({ status }: { status: Task['status'] }) {
  switch (status) {
    case 'done':
      return <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
    case 'in_progress':
      return <Clock className="w-3.5 h-3.5 text-blue-500 animate-pulse" />
    case 'blocked':
      return <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
    case 'pending':
    default:
      return <Circle className="w-3.5 h-3.5 text-muted-foreground" />
  }
}

/**
 * Individual task item component.
 */
function TaskItem({ task }: { task: Task }) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 py-1 px-2 rounded text-xs',
        task.status === 'done' && 'opacity-60'
      )}
    >
      <TaskStatusIcon status={task.status} />
      <span
        className={cn(
          'flex-1',
          task.status === 'done' && 'line-through'
        )}
      >
        {task.description}
      </span>
      {task.blockedBy && (
        <span className="text-[10px] text-amber-500 italic">
          ({task.blockedBy})
        </span>
      )}
    </div>
  )
}

export function TaskListPanel({ tasks, className }: TaskListPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true)

  // Auto-expand when tasks are added
  useEffect(() => {
    if (tasks.length > 0) {
      setIsExpanded(true)
    }
  }, [tasks.length])

  // Don't render if no tasks
  if (tasks.length === 0) {
    return null
  }

  const doneCount = tasks.filter(t => t.status === 'done').length
  const totalCount = tasks.length
  const progressPercent = totalCount > 0 ? (doneCount / totalCount) * 100 : 0

  return (
    <div className={cn('border-b border-border/50', className)}>
      {/* Collapsible header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-3 py-1.5 bg-muted/30 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
          )}
          <span className="text-xs font-semibold">
            Tasks ({doneCount}/{totalCount})
          </span>
        </div>

        {/* Progress bar */}
        <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-green-500 transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </button>

      {/* Task list (collapsible) */}
      {isExpanded && (
        <div className="px-2 py-1.5 space-y-0.5 max-h-48 overflow-y-auto thin-scrollbar">
          {/* Show in-progress first, then pending, then blocked, then done */}
          {tasks
            .sort((a, b) => {
              const order = { in_progress: 0, pending: 1, blocked: 2, done: 3 }
              return order[a.status] - order[b.status]
            })
            .map(task => (
              <TaskItem key={task.id} task={task} />
            ))}
        </div>
      )}
    </div>
  )
}
