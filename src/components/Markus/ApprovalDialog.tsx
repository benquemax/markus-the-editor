/**
 * ApprovalDialog Component
 *
 * Displays a summary of completed work and asks for user approval.
 * The user can approve to clear the task list, or send a message
 * with requested changes to continue the conversation.
 */

import { useState } from 'react'
import { CheckCircle, FileText, MessageSquare } from 'lucide-react'
import { cn } from '../../lib/utils'

interface ApprovalDialogProps {
  summary: string
  filesChanged?: string[]
  onApprove: () => void
  onRequestChanges: (feedback: string) => void
  className?: string
}

export function ApprovalDialog({
  summary,
  filesChanged,
  onApprove,
  onRequestChanges,
  className
}: ApprovalDialogProps) {
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleApprove = () => {
    setIsSubmitting(true)
    onApprove()
  }

  const handleRequestChanges = () => {
    if (!feedback.trim()) return
    setIsSubmitting(true)
    onRequestChanges(feedback.trim())
  }

  return (
    <div className={cn(
      'p-4 rounded-lg border border-green-500/30 bg-green-500/5',
      className
    )}>
      {/* Success header */}
      <div className="flex items-start gap-3 mb-4">
        <div className="p-1.5 rounded-full bg-green-500/10">
          <CheckCircle className="w-5 h-5 text-green-500" />
        </div>
        <div className="flex-1">
          <p className="font-medium text-sm text-green-700 dark:text-green-400">
            All tasks complete!
          </p>
        </div>
      </div>

      {/* Summary */}
      <div className="mb-4 p-3 rounded bg-background/50 border border-border/50">
        <p className="text-sm whitespace-pre-wrap">{summary}</p>
      </div>

      {/* Files changed */}
      {filesChanged && filesChanged.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
            <FileText className="w-3 h-3" />
            Files changed:
          </p>
          <ul className="space-y-1">
            {filesChanged.map(file => (
              <li
                key={file}
                className="text-xs text-muted-foreground pl-3 border-l-2 border-green-500/30"
              >
                {file}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Feedback input (toggle) */}
      {showFeedback ? (
        <div className="mb-4">
          <div className="flex items-center gap-1.5 mb-2">
            <MessageSquare className="w-3 h-3 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">
              Request changes:
            </span>
          </div>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Describe what you'd like changed..."
            className="w-full p-2 text-sm bg-background border rounded resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            rows={3}
            autoFocus
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleRequestChanges}
              disabled={!feedback.trim() || isSubmitting}
              className={cn(
                'flex-1 py-1.5 px-3 rounded text-sm font-medium transition-colors',
                feedback.trim() && !isSubmitting
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-muted text-muted-foreground cursor-not-allowed'
              )}
            >
              Send Feedback
            </button>
            <button
              onClick={() => setShowFeedback(false)}
              className="py-1.5 px-3 rounded text-sm text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={handleApprove}
            disabled={isSubmitting}
            className={cn(
              'flex-1 py-2 px-4 rounded font-medium text-sm transition-colors',
              !isSubmitting
                ? 'bg-green-600 text-white hover:bg-green-700'
                : 'bg-muted text-muted-foreground cursor-not-allowed'
            )}
          >
            {isSubmitting ? 'Approving...' : 'Approve'}
          </button>
          <button
            onClick={() => setShowFeedback(true)}
            disabled={isSubmitting}
            className="py-2 px-4 rounded text-sm text-muted-foreground hover:bg-muted transition-colors"
          >
            Request Changes
          </button>
        </div>
      )}
    </div>
  )
}
