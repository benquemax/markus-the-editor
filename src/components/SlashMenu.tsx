import { useEffect, useRef } from 'react'
import { SlashMenuState, SlashMenuItem } from '../editor/plugins/slashMenu'
import { cn } from '../lib/utils'

interface SlashMenuProps {
  state: SlashMenuState
  onSelect: (item: SlashMenuItem) => void
}

export function SlashMenu({ state, onSelect }: SlashMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef<HTMLButtonElement>(null)

  // Scroll selected item into view
  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: 'nearest' })
    }
  }, [state.selectedIndex])

  if (!state.active || !state.position) {
    return null
  }

  return (
    <div
      ref={menuRef}
      className="slash-menu fixed z-50 max-h-80 overflow-y-auto"
      style={{
        top: state.position.top + 4,
        left: state.position.left
      }}
    >
      {state.items.length === 0 ? (
        <div className="px-3 py-2 text-sm text-muted-foreground">
          No results found
        </div>
      ) : (
        state.items.map((item, index) => (
          <button
            key={item.id}
            ref={index === state.selectedIndex ? selectedRef : null}
            className={cn(
              'slash-menu-item w-full text-left',
              index === state.selectedIndex && 'bg-accent'
            )}
            onClick={() => onSelect(item)}
            onMouseEnter={() => {
              // Could dispatch to update selected index on hover
            }}
          >
            <span className="slash-menu-item-icon w-8 h-8 flex items-center justify-center bg-muted rounded text-xs font-mono">
              {item.icon}
            </span>
            <div className="flex flex-col">
              <span className="slash-menu-item-label">{item.label}</span>
              <span className="slash-menu-item-description">{item.description}</span>
            </div>
          </button>
        ))
      )}
    </div>
  )
}
