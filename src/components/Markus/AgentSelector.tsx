/**
 * AgentSelector Component
 *
 * Row of pill-shaped toggles for selecting which agents are active
 * in the current conversation. Renders nothing when no agents are defined.
 * Appears between the ConversationHeader and TaskListPanel.
 */

import { Bot } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { AgentDefinition } from '../../lib/markus/client'

interface AgentSelectorProps {
  agents: AgentDefinition[]
  selectedIds: Set<string>
  onToggle: (id: string) => void
  className?: string
}

export function AgentSelector({ agents, selectedIds, onToggle, className }: AgentSelectorProps) {
  if (agents.length === 0) return null

  return (
    <div className={cn('px-3 py-1.5 border-b border-border/50 bg-muted/20', className)}>
      <div className="flex items-center gap-1.5 flex-wrap">
        <Bot className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        {agents.map(agent => {
          const isSelected = selectedIds.has(agent.id)
          return (
            <button
              key={agent.id}
              onClick={() => onToggle(agent.id)}
              title={agent.description}
              className={cn(
                'px-2 py-0.5 rounded-full text-xs font-medium transition-colors',
                isSelected
                  ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/30'
                  : 'bg-muted/50 text-muted-foreground border border-transparent hover:border-border'
              )}
            >
              {agent.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}
