/**
 * CommentInput Component
 *
 * Text input for adding a new comment or replying to a thread.
 * Supports Enter to submit and Shift+Enter for newline.
 * Integrates @mention autocomplete for tagging collaborators or @markus.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { MentionAutocomplete } from './MentionAutocomplete'

interface CommentInputProps {
  onSubmit: (text: string) => void
  placeholder?: string
  autoFocus?: boolean
}

export function CommentInput({ onSubmit, placeholder, autoFocus = false }: CommentInputProps) {
  const [text, setText] = useState('')
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionAnchor, setMentionAnchor] = useState<{ top: number; left: number } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [autoFocus])

  // Detect '@' trigger and compute mention query
  const updateMentionState = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    const cursorPos = textarea.selectionStart
    const textBefore = text.slice(0, cursorPos)

    // Find the last '@' before cursor that's either at start or preceded by whitespace
    const atMatch = textBefore.match(/(^|[\s])@([^\s]*)$/)

    if (atMatch) {
      setMentionQuery(atMatch[2])

      // Calculate anchor position relative to the container
      if (containerRef.current) {
        const containerRect = containerRef.current.getBoundingClientRect()
        const textareaRect = textarea.getBoundingClientRect()
        setMentionAnchor({
          top: textareaRect.top - containerRect.top,
          left: 8
        })
      }
    } else {
      setMentionQuery(null)
      setMentionAnchor(null)
    }
  }, [text])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value)
  }, [])

  // Update mention state whenever text or cursor changes
  useEffect(() => {
    updateMentionState()
  }, [text, updateMentionState])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Let MentionAutocomplete handle keys when it's active
    if (mentionQuery !== null) return

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (text.trim()) {
        onSubmit(text.trim())
        setText('')
        setMentionQuery(null)
      }
    }
  }

  const handleMentionSelect = useCallback((name: string) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const cursorPos = textarea.selectionStart
    const textBefore = text.slice(0, cursorPos)
    const textAfter = text.slice(cursorPos)

    // Replace the @query with @name
    const atIndex = textBefore.lastIndexOf('@')
    const newText = textBefore.slice(0, atIndex) + '@' + name + ' ' + textAfter

    setText(newText)
    setMentionQuery(null)
    setMentionAnchor(null)

    // Restore focus and cursor position after state update
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        const newCursorPos = atIndex + name.length + 2 // +2 for '@' and space
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
      }
    })
  }, [text])

  const handleMentionClose = useCallback(() => {
    setMentionQuery(null)
    setMentionAnchor(null)
  }, [])

  return (
    <div ref={containerRef} className="relative">
      {mentionQuery !== null && (
        <MentionAutocomplete
          query={mentionQuery}
          anchorRect={mentionAnchor}
          onSelect={handleMentionSelect}
          onClose={handleMentionClose}
        />
      )}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onClick={updateMentionState}
        placeholder={placeholder ?? 'Tag @markus or someone else'}
        className="w-full text-xs p-2 border border-border rounded bg-background text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring"
        rows={2}
      />
    </div>
  )
}
