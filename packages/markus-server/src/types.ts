/**
 * Server Types
 *
 * Type definitions for the Markus standalone server.
 * These types are used for HTTP and WebSocket API contracts.
 */

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
}

/**
 * Request to create a new conversation.
 */
export interface CreateConversationRequest {
  workspaceFolders: string[]
  filebarId?: string
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
