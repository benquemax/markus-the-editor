/**
 * Markus AI Agent Types
 *
 * Core type definitions for the Markus AI assistant feature.
 * These types are shared between the main process modules for
 * LLM communication, tool execution, memory, and conversations.
 */

// ============================================================================
// Settings Types
// ============================================================================

/**
 * LLM provider settings for API communication.
 */
export interface LLMSettings {
  apiEndpoint: string
  apiKey: string
  model: string
  /** Maximum tokens for response generation */
  maxTokens?: number
  /** Temperature for response randomness (0-2) */
  temperature?: number
}

/**
 * Web search configuration for SearxNG integration.
 */
export interface SearchSettings {
  /** SearxNG instance URL, if configured */
  searxngUrl?: string
  /** Whether to use DuckDuckGo AI for searches */
  useDuckDuckGo: boolean
}

/**
 * Complete Markus settings stored in YAML config.
 */
export interface MarkusSettings {
  llm: LLMSettings
  search: SearchSettings
  /** Default to planning mode requiring tool approval */
  defaultPlanningMode: boolean
  /** YOLO mode - execute tools without approval */
  yoloMode: boolean
}

/**
 * Default settings used when no config file exists.
 */
export const DEFAULT_MARKUS_SETTINGS: MarkusSettings = {
  llm: {
    apiEndpoint: 'https://api.openai.com/v1/chat/completions',
    apiKey: '',
    model: 'gpt-4o-mini',
    maxTokens: 4096,
    temperature: 0.7
  },
  search: {
    useDuckDuckGo: true
  },
  defaultPlanningMode: true,
  yoloMode: false
}

// ============================================================================
// Message Types
// ============================================================================

/**
 * Role of a message in the conversation.
 */
export type MessageRole = 'user' | 'assistant' | 'system'

/**
 * Status of a message during streaming/processing.
 */
export type MessageStatus = 'pending' | 'streaming' | 'complete' | 'error'

/**
 * Status of a tool call execution.
 */
export type ToolCallStatus = 'pending' | 'approved' | 'rejected' | 'executing' | 'complete' | 'error'

/**
 * Record of a tool call made by the assistant.
 */
export interface ToolCallRecord {
  id: string
  name: string
  arguments: Record<string, unknown>
  status: ToolCallStatus
  result?: unknown
  error?: string
  /** Timestamp when tool was called */
  startedAt: number
  /** Timestamp when tool completed */
  completedAt?: number
}

/**
 * A single message in a conversation.
 */
export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  timestamp: number
  /** Tool calls made during this message */
  toolCalls?: ToolCallRecord[]
  /** Whether this is a planning mode message */
  isPlan?: boolean
  status: MessageStatus
  /** Error message if status is 'error' */
  error?: string
}

/**
 * A conversation thread between user and Markus.
 */
export interface Conversation {
  id: string
  /** Auto-generated title from first message */
  title: string
  /** Associated filebar ID for persistence grouping */
  filebarId: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

// ============================================================================
// LLM Types
// ============================================================================

/**
 * Message format for OpenAI-compatible API.
 */
export interface LLMMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

/**
 * Tool definition for LLM function calling.
 */
export interface ToolDefinition {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, {
      type: string
      description: string
      enum?: string[]
    }>
    required?: string[]
  }
}

/**
 * Parsed tool call from LLM response (either native or MD_JSON).
 */
export interface ParsedToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

/**
 * Response from LLM after parsing.
 */
export interface LLMResponse {
  content: string
  toolCalls: ParsedToolCall[]
  /** Raw response for debugging */
  rawResponse?: unknown
}

/**
 * Streaming chunk from LLM.
 */
export interface LLMStreamChunk {
  type: 'content' | 'tool_call' | 'done' | 'error'
  content?: string
  toolCall?: ParsedToolCall
  error?: string
}

// ============================================================================
// Tool Types
// ============================================================================

/**
 * Available tool names in Markus.
 */
export type ToolName =
  | 'read_file'
  | 'list_directory'
  | 'edit_file'
  | 'create_file'
  | 'delete_file'
  | 'create_directory'
  | 'search_files'
  | 'search_web'
  | 'duck_ai'
  | 'get_open_files'
  | 'get_workspace_folders'
  | 'update_memory'

/**
 * Result of tool execution.
 */
export interface ToolResult {
  success: boolean
  result?: unknown
  error?: string
  /** File that should be auto-opened after creation/edit */
  openFile?: string
}

/**
 * Context provided to tool execution.
 */
export interface ToolContext {
  /** Allowed workspace directories (from filebar) */
  workspaceFolders: string[]
  /** Currently open files in editor */
  openFiles: string[]
  /** Main window reference for file operations */
  mainWindow: Electron.BrowserWindow | null
}

// ============================================================================
// Memory Types
// ============================================================================

/**
 * Scope of memory storage.
 */
export type MemoryScope = 'system' | 'project'

/**
 * Action to perform on memory.
 */
export type MemoryAction = 'add' | 'update' | 'remove'

/**
 * Request to update memory.
 */
export interface MemoryUpdateRequest {
  scope: MemoryScope
  action: MemoryAction
  /** Section header in markdown */
  section: string
  /** New content for the section */
  content: string
}

/**
 * Proposed memory update awaiting user confirmation.
 */
export interface MemoryUpdateProposal {
  id: string
  scope: MemoryScope
  /** Current content being modified */
  currentContent: string
  /** Proposed new content */
  proposedContent: string
  /** Diff preview for UI */
  diff: string
}

// ============================================================================
// IPC Event Types
// ============================================================================

/**
 * Events sent from main to renderer for streaming.
 */
export interface MarkusEvents {
  'markus:messageChunk': { conversationId: string; chunk: string }
  'markus:toolCallStarted': { conversationId: string; toolCall: ToolCallRecord }
  'markus:toolCallComplete': { conversationId: string; toolCallId: string; result: ToolResult }
  'markus:requestComplete': { conversationId: string; messageId: string }
  'markus:requestError': { conversationId: string; error: string }
}

/**
 * Conversation list item for UI display.
 */
export interface ConversationListItem {
  id: string
  title: string
  updatedAt: number
  messageCount: number
}
