/**
 * CommentThread Component
 *
 * Displays a single comment thread with all entries (author + text),
 * a reply input, and a "Mark resolved" button.
 */

import { CommentThread as CommentThreadType } from '../../lib/comments'
import { CommentInput } from './CommentInput'

interface CommentThreadProps {
  thread: CommentThreadType
  isActive: boolean
  onClick: () => void
  onAddReply: (text: string) => void
  onResolve: () => void
}

export function CommentThreadView({
  thread, isActive, onClick, onAddReply, onResolve
}: CommentThreadProps) {
  return (
    <div
      className={`
        border rounded-lg p-3 text-xs cursor-pointer transition-all
        ${isActive
          ? 'border-yellow-400 dark:border-yellow-500 bg-background shadow-sm'
          : 'border-border bg-muted/30 hover:bg-muted/50'
        }
      `}
      onClick={onClick}
    >
      {/* Thread entries */}
      <div className="space-y-2">
        {thread.entries.map((entry, i) => (
          <div key={i}>
            <span className="font-semibold text-foreground">{entry.author}</span>
            <p className="text-muted-foreground mt-0.5 whitespace-pre-wrap">{entry.text}</p>
          </div>
        ))}

        {thread.entries.length === 0 && (
          <p className="text-muted-foreground italic">New comment</p>
        )}
      </div>

      {/* Reply input + resolve — only shown when active */}
      {isActive && (
        <div className="mt-2 space-y-2" onClick={e => e.stopPropagation()}>
          <CommentInput
            onSubmit={(text) => onAddReply(text)}
            autoFocus={thread.entries.length === 0}
          />
          {thread.entries.length > 0 && (
            <button
              onClick={onResolve}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Mark resolved
            </button>
          )}
        </div>
      )}
    </div>
  )
}
