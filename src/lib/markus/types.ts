/**
 * Markus Frontend Types
 *
 * TypeScript interfaces for the Markus AI agent feature in the renderer process.
 * These mirror the types from electron/preload.ts for use in React components.
 */

export interface MarkusSettings {
  llm: {
    apiEndpoint: string
    apiKey: string
    model: string
    maxTokens?: number
    temperature?: number
  }
  search: {
    searxngUrl?: string
    useDuckDuckGo: boolean
  }
  defaultPlanningMode: boolean
  yoloMode: boolean
}

export interface MarkusConversation {
  id: string
  title: string
  filebarId: string
  messages: MarkusChatMessage[]
  createdAt: number
  updatedAt: number
}

export interface MarkusChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  toolCalls?: MarkusToolCallRecord[]
  isPlan?: boolean
  status: 'pending' | 'streaming' | 'complete' | 'error'
  error?: string
}

export interface MarkusToolCallRecord {
  id: string
  name: string
  arguments: Record<string, unknown>
  status: 'pending' | 'approved' | 'rejected' | 'executing' | 'complete' | 'error'
  result?: unknown
  error?: string
  startedAt: number
  completedAt?: number
}

export interface MarkusConversationListItem {
  id: string
  title: string
  updatedAt: number
  messageCount: number
}

export interface MarkusMemoryProposal {
  id: string
  scope: 'system' | 'project'
  currentContent: string
  proposedContent: string
  diff: string
}

// ============================================================================
// Multi-Agent Types
// ============================================================================

/**
 * Agent type in the multi-agent system.
 */
export type AgentType = 'orchestrator' | 'editor' | 'research' | 'critique' | 'style' | 'creative'

/**
 * Agent status.
 */
export type AgentStatus = 'idle' | 'thinking' | 'executing' | 'waiting' | 'error'

/**
 * Status of an agent for display.
 */
export interface AgentStatusInfo {
  type: AgentType
  status: AgentStatus
  details?: string
}

/**
 * RAG index status.
 */
export interface RAGIndexStatus {
  indexing: boolean
  totalFiles: number
  indexedFiles: number
  totalChunks: number
  lastUpdated: number | null
  error?: string
}

/**
 * Agent settings for configuration.
 */
export interface AgentSettings {
  model: string
  endpoint: string
  apiKey?: string
  maxTokens: number
  temperature: number
}

/**
 * Multi-agent system settings.
 */
export interface MultiAgentSettings {
  defaults: Partial<AgentSettings>
  orchestrator?: Partial<AgentSettings>
  editor?: Partial<AgentSettings>
  research?: Partial<AgentSettings>
  critique?: Partial<AgentSettings>
  style?: Partial<AgentSettings>
  creative?: Partial<AgentSettings>
}

/**
 * Model preset for quick configuration.
 */
export interface ModelPreset {
  name: string
  endpoint: string
  model: string
}

// ============================================================================
// Task List Types (Thought Loop)
// ============================================================================

/**
 * A single task in the task list.
 */
export interface Task {
  id: string
  description: string
  status: 'pending' | 'in_progress' | 'done' | 'blocked'
  priority: number
  blockedBy?: string
  completedAt?: number
}

/**
 * Persistent task list for a conversation.
 */
export interface TaskList {
  conversationId: string
  tasks: Task[]
  createdAt: number
  updatedAt: number
}

/**
 * UI data for blocking tool calls.
 */
export interface BlockingToolUI {
  type: 'ask_user' | 'approval' | 'consult_boss'
  /** For ask_user */
  question?: string
  options?: string[]
  reason?: string
  /** For approval */
  summary?: string
  filesChanged?: string[]
  /** For consult_boss */
  message?: string
  messageType?: 'info' | 'success' | 'warning' | 'error' | 'progress'
}

// ============================================================================
// Thought Loop Types (for debugging UI)
// ============================================================================

/**
 * Context source for debugging what was included in LLM context.
 */
export interface ContextSource {
  type: 'system_prompt' | 'mode_instructions' | 'user_message' | 'consult_boss' |
        'file_read' | 'task_list' | 'memory' | 'iteration_summary' | 'tool_result'
  reference?: string
  charCount: number
  truncated?: boolean
}

/**
 * Thought iteration for debugging display.
 */
export interface ThoughtIterationDebug {
  id: string
  index: number
  mode: 'planning' | 'execution'
  toolCallCount: number
  toolNames: string[]
  endState: string
  timing: {
    startedAt: number
    endedAt: number
    durationMs: number
  }
}

/**
 * Conversation log summary for debugging.
 */
export interface ConversationLogDebug {
  id: string
  mode: 'planning' | 'execution'
  userMessageCount: number
  iterationCount: number
  totalToolCalls: number
  estimatedTokens: number
  contextSources: ContextSource[]
}
