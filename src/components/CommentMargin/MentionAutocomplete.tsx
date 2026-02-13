/**
 * MentionAutocomplete Component
 *
 * Dropdown popup that appears when user types '@' in a comment input.
 * Shows git collaborators and the special @markus option.
 * Positioned above the input field.
 */

import { useState, useEffect, useRef, useCallback } from 'react'

interface MentionAutocompleteProps {
  /** The current query text after '@' */
  query: string
  /** Position of the '@' character relative to the input */
  anchorRect: { top: number; left: number } | null
  /** Called when user selects a mention */
  onSelect: (name: string) => void
  /** Called when the popup should close */
  onClose: () => void
}

export function MentionAutocomplete({ query, anchorRect, onSelect, onClose }: MentionAutocompleteProps) {
  const [collaborators, setCollaborators] = useState<string[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const menuRef = useRef<HTMLDivElement>(null)

  // Load collaborators once
  useEffect(() => {
    window.electron.git.getCollaborators().then(setCollaborators).catch(() => {})
  }, [])

  // Build filtered options: always include @markus, plus matching collaborators
  const allOptions = ['markus', ...collaborators.filter(c => c.toLowerCase() !== 'markus')]
  const filtered = query
    ? allOptions.filter(name => name.toLowerCase().startsWith(query.toLowerCase()))
    : allOptions

  // Reset selection when filtered list changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [filtered.length])

  // Handle keyboard navigation (called from parent via ref or event bubbling)
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (filtered.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(i => (i + 1) % filtered.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => (i - 1 + filtered.length) % filtered.length)
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      onSelect(filtered[selectedIndex])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }, [filtered, selectedIndex, onSelect, onClose])

  // Attach keyboard listener
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [handleKeyDown])

  if (!anchorRect || filtered.length === 0) return null

  return (
    <div
      ref={menuRef}
      className="absolute z-50 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[160px] max-h-[200px] overflow-auto"
      style={{
        bottom: `calc(100% - ${anchorRect.top}px + 4px)`,
        left: anchorRect.left
      }}
    >
      {filtered.map((name, i) => (
        <button
          key={name}
          className={`w-full text-left px-3 py-1.5 text-sm ${
            i === selectedIndex
              ? 'bg-accent text-accent-foreground'
              : 'text-foreground hover:bg-accent/50'
          }`}
          onMouseDown={(e) => {
            e.preventDefault()
            onSelect(name)
          }}
          onMouseEnter={() => setSelectedIndex(i)}
        >
          @{name}
        </button>
      ))}
    </div>
  )
}
