/**
 * ContextMenu Component
 *
 * A generic right-click context menu that renders at the given position.
 * Closes on click outside, Escape, or item selection.
 */

import { useEffect, useRef } from 'react'

export interface ContextMenuItem {
  id: string
  label: string
  shortcut?: string
  action: () => void
}

interface ContextMenuProps {
  items: ContextMenuItem[]
  position: { x: number; y: number }
  onClose: () => void
}

export function ContextMenu({ items, position, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }

    // Delay adding listeners to avoid the triggering right-click from closing the menu
    requestAnimationFrame(() => {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleEscape)
    })

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[180px] bg-popover text-popover-foreground border border-border rounded-md shadow-md py-1"
      style={{ left: position.x, top: position.y }}
    >
      {items.map(item => (
        <button
          key={item.id}
          className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground flex items-center justify-between gap-4"
          onClick={() => {
            item.action()
            onClose()
          }}
        >
          <span>{item.label}</span>
          {item.shortcut && (
            <span className="text-xs text-muted-foreground">{item.shortcut}</span>
          )}
        </button>
      ))}
    </div>
  )
}
