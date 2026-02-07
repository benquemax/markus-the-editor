/**
 * AskUserDialog Component
 *
 * Displays a question from the agent with clickable options.
 * Always includes an "Other" option with a text input.
 * Pauses the thought loop until the user responds.
 */

import { useState } from 'react'
import { HelpCircle } from 'lucide-react'
import { cn } from '../../lib/utils'

interface AskUserDialogProps {
  question: string
  options: string[]
  reason?: string
  onSubmit: (response: string) => void
  className?: string
}

export function AskUserDialog({
  question,
  options,
  reason,
  onSubmit,
  className
}: AskUserDialogProps) {
  const [selected, setSelected] = useState<string | null>(null)
  const [otherText, setOtherText] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = () => {
    if (!selected) return

    setIsSubmitting(true)
    const response = selected === 'Other' ? otherText : selected
    onSubmit(response)
  }

  const isValid = selected && (selected !== 'Other' || otherText.trim())

  return (
    <div className={cn(
      'p-4 rounded-lg border border-border bg-muted/30',
      className
    )}>
      {/* Question header */}
      <div className="flex items-start gap-3 mb-4">
        <div className="p-1.5 rounded-full bg-blue-500/10">
          <HelpCircle className="w-4 h-4 text-blue-500" />
        </div>
        <div className="flex-1">
          <p className="font-medium text-sm">{question}</p>
          {reason && (
            <p className="text-xs text-muted-foreground mt-1">{reason}</p>
          )}
        </div>
      </div>

      {/* Options */}
      <div className="space-y-2 mb-4">
        {options.map(option => (
          <label
            key={option}
            className={cn(
              'flex items-center gap-3 p-2 rounded cursor-pointer transition-colors',
              selected === option
                ? 'bg-primary/10 border border-primary/30'
                : 'bg-muted/50 hover:bg-muted border border-transparent'
            )}
          >
            <input
              type="radio"
              name="option"
              checked={selected === option}
              onChange={() => setSelected(option)}
              className="w-4 h-4 text-primary"
            />
            <span className="text-sm flex-1">{option}</span>

            {/* Text input for "Other" option */}
            {option === 'Other' && selected === 'Other' && (
              <input
                type="text"
                value={otherText}
                onChange={(e) => setOtherText(e.target.value)}
                placeholder="Type your answer..."
                className="flex-1 px-2 py-1 text-sm bg-background border rounded focus:outline-none focus:ring-1 focus:ring-primary"
                autoFocus
              />
            )}
          </label>
        ))}
      </div>

      {/* Submit button */}
      <button
        onClick={handleSubmit}
        disabled={!isValid || isSubmitting}
        className={cn(
          'w-full py-2 px-4 rounded font-medium text-sm transition-colors',
          isValid && !isSubmitting
            ? 'bg-primary text-primary-foreground hover:bg-primary/90'
            : 'bg-muted text-muted-foreground cursor-not-allowed'
        )}
      >
        {isSubmitting ? 'Submitting...' : 'Submit'}
      </button>
    </div>
  )
}
