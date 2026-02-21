/**
 * Simple tab bar for terminal sessions.
 *
 * Shows tab titles, a close button per tab, and a + button to create
 * new terminals. Styled to match the editor's tab bar aesthetic.
 */

import { X, Plus } from 'lucide-react'
import { cn } from '../../lib/utils'

export interface TerminalTab {
  id: string
  title: string
}

interface TerminalTabsProps {
  tabs: TerminalTab[]
  activeTabId: string | null
  onTabClick: (id: string) => void
  onTabClose: (id: string) => void
  onNewTab: () => void
}

export function TerminalTabs({ tabs, activeTabId, onTabClick, onTabClose, onNewTab }: TerminalTabsProps) {
  return (
    <div className="flex items-center h-8 border-b border-border/50 px-1 gap-0.5 flex-shrink-0">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={cn(
            "flex items-center gap-1 px-2 py-1 text-xs rounded-sm transition-colors",
            "hover:bg-accent/50",
            tab.id === activeTabId
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground"
          )}
          onClick={() => onTabClick(tab.id)}
        >
          <span className="truncate max-w-[100px]">{tab.title}</span>
          {tabs.length > 1 && (
            <span
              className="hover:bg-accent rounded-sm p-0.5"
              onClick={(e) => {
                e.stopPropagation()
                onTabClose(tab.id)
              }}
            >
              <X className="w-3 h-3" />
            </span>
          )}
        </button>
      ))}
      <button
        className="p-1 text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded-sm transition-colors"
        onClick={onNewTab}
        title="New terminal"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
