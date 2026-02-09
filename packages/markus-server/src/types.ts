/**
 * Server Types
 *
 * Type definitions for the Markus standalone server.
 * These types are used for HTTP and WebSocket API contracts.
 */

// ============================================================================
// Provider Types
// ============================================================================

/**
 * An LLM provider configuration, allowing multiple agents to share
 * the same endpoint and API key without duplication.
 */
export interface Provider {
  id: string
  name: string
  /** Base URL, e.g. "https://api.mistral.ai/v1" */
  endpoint: string
  apiKey?: string
  /** Suggested default model for this provider */
  defaultModel?: string
  createdAt: number
  updatedAt: number
}

/**
 * Request to create a new provider.
 */
export interface CreateProviderRequest {
  name: string
  endpoint: string
  apiKey?: string
  defaultModel?: string
}

/**
 * Request to update a provider. All fields optional.
 */
export interface UpdateProviderRequest {
  name?: string
  endpoint?: string
  apiKey?: string
  defaultModel?: string
}

/**
 * Model information returned by OpenAI-compatible /v1/models endpoint.
 */
export interface ModelInfo {
  id: string
  owned_by?: string
}

// ============================================================================
// Agent Definition Types
// ============================================================================

/**
 * An API-defined agent with instruction-driven behavior.
 * Clients create these via REST, then select which agents to use per conversation.
 *
 * LLM resolution order:
 * 1. If providerId set → resolve endpoint/apiKey from that provider
 * 2. If raw endpoint set (no providerId) → use as-is (backward compat)
 * 3. Neither → fall back to main LLM settings from settings.yaml
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
  /** Provider ID — if set, endpoint/apiKey are resolved from the provider at runtime */
  providerId?: string
  model: string
  /** Direct endpoint override. Optional if providerId is set or using main settings. */
  endpoint?: string
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
 * Either providerId or endpoint should be provided; if neither, main settings are used.
 */
export interface CreateAgentDefinitionRequest {
  slug: string
  name: string
  roleDefinition: string
  whenToUse: string
  description: string
  customInstructions?: string
  providerId?: string
  model: string
  /** Optional — not required if providerId is set or using main settings fallback */
  endpoint?: string
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
  providerId?: string | null
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
