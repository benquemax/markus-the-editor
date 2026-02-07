/**
 * AgentActivityDisplay Component
 *
 * Shows the current status of all agents in the multi-agent system.
 * Displays badges/indicators for each agent's state (thinking, executing, idle).
 */

import { Bot, Search, FileEdit, MessageSquare, Palette, Lightbulb, Loader2 } from 'lucide-react'
import type { AgentType, AgentStatus, AgentStatusInfo } from '../../lib/markus/types'

interface AgentActivityDisplayProps {
  /** Status of all agents */
  agents: AgentStatusInfo[]
  /** Whether to show all agents or just active ones */
  showAll?: boolean
  /** Compact mode for smaller displays */
  compact?: boolean
}

/**
 * Get icon for agent type.
 */
function getAgentIcon(type: AgentType) {
  switch (type) {
    case 'orchestrator':
      return Bot
    case 'editor':
      return FileEdit
    case 'research':
      return Search
    case 'critique':
      return MessageSquare
    case 'style':
      return Palette
    case 'creative':
      return Lightbulb
    default:
      return Bot
  }
}

/**
 * Get display name for agent type.
 */
function getAgentName(type: AgentType): string {
  switch (type) {
    case 'orchestrator':
      return 'Markus'
    case 'editor':
      return 'Editor'
    case 'research':
      return 'Research'
    case 'critique':
      return 'Critique'
    case 'style':
      return 'Style'
    case 'creative':
      return 'Creative'
    default:
      return type
  }
}

/**
 * Get status color classes.
 */
function getStatusClasses(status: AgentStatus): string {
  switch (status) {
    case 'thinking':
      return 'bg-amber-500/20 text-amber-500 border-amber-500/30'
    case 'executing':
      return 'bg-blue-500/20 text-blue-500 border-blue-500/30'
    case 'waiting':
      return 'bg-purple-500/20 text-purple-500 border-purple-500/30'
    case 'error':
      return 'bg-red-500/20 text-red-500 border-red-500/30'
    case 'idle':
    default:
      return 'bg-muted/50 text-muted-foreground border-muted'
  }
}

/**
 * Get status text.
 */
function getStatusText(status: AgentStatus): string {
  switch (status) {
    case 'thinking':
      return 'thinking'
    case 'executing':
      return 'working'
    case 'waiting':
      return 'waiting'
    case 'error':
      return 'error'
    case 'idle':
    default:
      return 'idle'
  }
}

/**
 * Single agent badge.
 */
function AgentBadge({
  agent,
  compact
}: {
  agent: AgentStatusInfo
  compact?: boolean
}) {
  const Icon = getAgentIcon(agent.type)
  const isActive = agent.status !== 'idle'

  if (compact) {
    return (
      <div
        className={`
          flex items-center gap-1 px-1.5 py-0.5 rounded text-xs border
          ${getStatusClasses(agent.status)}
          ${isActive ? 'animate-pulse' : ''}
        `}
        title={`${getAgentName(agent.type)}: ${getStatusText(agent.status)}${agent.details ? ` - ${agent.details}` : ''}`}
      >
        {isActive ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <Icon className="w-3 h-3" />
        )}
      </div>
    )
  }

  return (
    <div
      className={`
        flex items-center gap-1.5 px-2 py-1 rounded-md text-xs border
        ${getStatusClasses(agent.status)}
        transition-all duration-200
      `}
    >
      {isActive ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <Icon className="w-3.5 h-3.5" />
      )}
      <span className="font-medium">{getAgentName(agent.type)}</span>
      {isActive && (
        <span className="text-[10px] opacity-75">{getStatusText(agent.status)}</span>
      )}
    </div>
  )
}

export function AgentActivityDisplay({
  agents,
  showAll = false,
  compact = false
}: AgentActivityDisplayProps) {
  // Filter to active agents unless showAll
  const displayAgents = showAll
    ? agents
    : agents.filter(a => a.status !== 'idle')

  if (displayAgents.length === 0 && !showAll) {
    return null
  }

  return (
    <div className="flex flex-wrap gap-1">
      {displayAgents.map(agent => (
        <AgentBadge key={agent.type} agent={agent} compact={compact} />
      ))}
    </div>
  )
}
