/**
 * Server Types
 *
 * Type definitions for the Markus standalone server.
 * These types are used for HTTP and WebSocket API contracts.
 */

// ============================================================================
// Agent Definition Types
// ============================================================================

/**
 * An API-defined agent with instruction-driven behavior.
 * Clients create these via REST, then select which agents to use per conversation.
 */
export interface AgentDefinition {
  /** UUID, auto-generated */
  id: string
  /** Machine-readable name, e.g. "narrative-architect" */
  slug: string
  /** Human-readable name, e.g. "Narrative Architect" */
  name: string
  /** Core instructions defining agent identity and behavior */
  roleDefinition: string
  /** Guidance on when to engage this agent (for orchestration/routing) */
  whenToUse: string
  /** Short description */
  description: string
  /** Additional per-agent instructions */
  customInstructions?: string
  // LLM configuration
  model: string
  endpoint: string
  apiKey?: string
  maxTokens: number
  temperature: number
  timeout?: number
  /** Which tools this agent can use (tool names). Omit for default set. */
  tools?: string[]
  // Metadata
  createdAt: number
  updatedAt: number
}

/**
 * Request to create a new agent definition.
 * All fields except id, createdAt, updatedAt.
 */
export interface CreateAgentDefinitionRequest {
  slug: string
  name: string
  roleDefinition: string
  whenToUse: string
  description: string
  customInstructions?: string
  model: string
  endpoint: string
  apiKey?: string
  maxTokens?: number
  temperature?: number
  timeout?: number
  /** Which tools this agent can use (tool names). Omit for default set. */
  tools?: string[]
}

/**
 * Request to update an agent definition. All fields optional.
 */
export interface UpdateAgentDefinitionRequest {
  slug?: string
  name?: string
  roleDefinition?: string
  whenToUse?: string
  description?: string
  customInstructions?: string
  model?: string
  endpoint?: string
  apiKey?: string
  maxTokens?: number
  temperature?: number
  timeout?: number
  /** Which tools this agent can use (tool names). Omit for default set. */
  tools?: string[]
}

// ============================================================================
// Conversation Types
// ============================================================================

/**
 * Information about a conversation, returned by API endpoints.
 */
export interface ConversationInfo {
  id: string
  workspaceFolders: string[]
  filebarId: string
  createdAt: number
  title?: string
  /** Agent definition IDs selected for this conversation */
  agentIds?: string[]
}

/**
 * Request to create a new conversation.
 */
export interface CreateConversationRequest {
  workspaceFolders: string[]
  filebarId?: string
  /** Agent definition IDs to use for this conversation */
  agentIds?: string[]
}

// ============================================================================
// WebSocket Protocol Types
// ============================================================================

/**
 * Messages sent from client to server over WebSocket.
 */
export type ClientMessage =
  | { type: 'message'; content: string; planningMode: boolean; yoloMode: boolean }
  | { type: 'tool_response'; toolCallId: string; response: string | boolean }
  | { type: 'cancel' }

/**
 * Messages sent from server to client over WebSocket.
 */
export type ServerMessage =
  | { type: 'chunk'; content: string }
  | { type: 'tool_started'; toolCall: ToolCallInfo }
  | { type: 'tool_complete'; toolCallId: string; result: ToolCallResult }
  | { type: 'blocking'; toolCallId: string; uiData: BlockingToolUI }
  | { type: 'tasks_updated'; tasks: Task[] }
  | { type: 'complete'; waitingForInput: boolean }
  | { type: 'error'; message: string }
  | { type: 'iteration_started'; iterationIndex: number }

/**
 * Tool call information sent to clients.
 */
export interface ToolCallInfo {
  id: string
  name: string
  arguments: Record<string, unknown>
  blocking?: boolean
}

/**
 * Result of a tool call.
 */
export interface ToolCallResult {
  success: boolean
  data?: unknown
  error?: string
}

/**
 * UI data for blocking tool calls.
 */
export interface BlockingToolUI {
  type: 'ask_user' | 'approval' | 'consult_boss'
  question?: string
  options?: string[]
  reason?: string
  summary?: string
  filesChanged?: string[]
  message?: string
  messageType?: 'info' | 'success' | 'warning' | 'error' | 'progress'
}

/**
 * A task in the task list.
 */
export interface Task {
  id: string
  description: string
  status: 'pending' | 'in_progress' | 'done' | 'blocked'
  priority: number
  blockedBy?: string
  completedAt?: number
}

// ============================================================================
// Settings Types
// ============================================================================

/**
 * LLM provider settings.
 */
export interface LLMSettings {
  apiEndpoint: string
  apiKey: string
  model: string
  maxTokens?: number
  temperature?: number
}

/**
 * Search settings.
 */
export interface SearchSettings {
  searxngUrl?: string
  useDuckDuckGo: boolean
}

/**
 * Complete Markus settings.
 */
export interface MarkusSettings {
  llm: LLMSettings
  search: SearchSettings
  defaultPlanningMode: boolean
  yoloMode: boolean
}
