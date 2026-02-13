/**
 * Markus AI Agent Types
 *
 * Core type definitions for the Markus AI assistant feature.
 * These types are shared between the main process modules for
 * LLM communication, tool execution, memory, and conversations.
 */

// Re-export multi-agent types for convenience
export type {
  AgentType,
  AgentStatus,
  AgentSettings,
  MultiAgentSettings,
  RAGSettings,
  ModelPreset,
  AgentMessage,
  AgentMessageType,
  AgentTask,
  SearchReplaceEdit,
  EditResult
} from './agents/types'

// Re-export thought loop types for convenience
export type {
  ConversationLog,
  UserMessage,
  ThoughtIteration,
  ToolCallLog,
  ToolCallResult,
  LLMRequestContext,
  LLMResponseData,
  ContextSource,
  ContextSourceType,
  TaskState,
  IterationEndState,
  ThoughtLoopEvent,
  ThoughtLoopEventHandler,
  LoopState,
  StopCondition
} from './thoughtLoop/types'

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
  /** Multi-agent system settings (optional, enables advanced mode) */
  agents?: import('./agents/types').MultiAgentSettings
  /** RAG settings for vector search */
  rag?: import('./agents/types').RAGSettings
  /** Model presets for quick configuration */
  modelPresets?: Record<string, import('./agents/types').ModelPreset>
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
  yoloMode: false,
  // Multi-agent settings - enabled by default with sensible defaults
  agents: {
    defaults: {
      model: 'gpt-4o-mini',
      endpoint: 'http://localhost:11434/v1',
      maxTokens: 4096,
      temperature: 0.7
    },
    orchestrator: {
      maxTokens: 8192
    },
    editor: {
      maxTokens: 4096,
      temperature: 0.3
    },
    research: {
      maxTokens: 6144
    },
    critique: {
      maxTokens: 6144
    },
    style: {
      maxTokens: 4096
    },
    creative: {
      maxTokens: 6144,
      temperature: 0.8
    }
  },
  // RAG settings
  rag: {
    enabled: true,
    embeddings: {
      provider: 'local',
      model: 'all-MiniLM-L6-v2'
    },
    chunking: {
      maxChunkSize: 512,
      overlap: 50
    }
  },
  // Model presets for easy configuration
  modelPresets: {
    'local-small': {
      name: 'Local Small (Ministral 8B)',
      endpoint: 'http://localhost:11434/v1',
      model: 'ministral-8b'
    },
    'local-medium': {
      name: 'Local Medium (Devstral 24B)',
      endpoint: 'http://localhost:11434/v1',
      model: 'devstral-small'
    },
    'openai-mini': {
      name: 'OpenAI GPT-4o Mini',
      endpoint: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini'
    },
    'openai-4o': {
      name: 'OpenAI GPT-4o',
      endpoint: 'https://api.openai.com/v1',
      model: 'gpt-4o'
    }
  }
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
  /** Associated workspace ID for persistence grouping */
  workspaceId: string
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
// Task Types (Thought Loop)
// ============================================================================

/**
 * A single task in the task list.
 */
export interface Task {
  id: string
  description: string
  status: 'pending' | 'in_progress' | 'done' | 'blocked'
  priority: number
  /** Reference to blocking task or reason */
  blockedBy?: string
  completedAt?: number
}

/**
 * Persistent task list for a conversation.
 * Survives context condensation and keeps the agent focused.
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
  | 'consult_boss'
  | 'update_tasks'
  | 'ask_user'
  | 'request_task_approval'

/**
 * Result of tool execution.
 */
export interface ToolResult {
  success: boolean
  result?: unknown
  error?: string
  /** File that should be auto-opened after creation/edit */
  openFile?: string
  /** Whether this tool blocks the thought loop waiting for user input */
  blocking?: boolean
  /** UI data for blocking tools */
  uiData?: BlockingToolUI
}

/**
 * Context provided to tool execution.
 */
export interface ToolContext {
  /** Allowed workspace directories */
  workspaceFolders: string[]
  /** Currently open files in editor */
  openFiles: string[]
  /** Main window reference for file operations */
  mainWindow: Electron.BrowserWindow | null
  /** Current workspace ID (for task storage) */
  workspaceId?: string
  /** Current conversation ID */
  conversationId?: string
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
