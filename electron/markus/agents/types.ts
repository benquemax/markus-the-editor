/**
 * Multi-Agent System Types
 *
 * Core type definitions for the multi-agent architecture.
 * Each agent has its own context window, model configuration, and specialized role.
 * Designed for small local models (Devstral 24B, Ministral 8B).
 */

// ============================================================================
// Agent Types
// ============================================================================

/**
 * Available agent types in the multi-agent system.
 * Each agent has a specialized role and recommended model.
 */
export type AgentType =
  | 'orchestrator'  // User-facing coordinator, task decomposition
  | 'editor'        // File creation/modification with SEARCH/REPLACE
  | 'research'      // File search, RAG queries, web search
  | 'critique'      // Quality review, consistency checking
  | 'style'         // Voice, tone, formatting consistency
  | 'creative'      // Ideas, structure, creative solutions

/**
 * Status of an agent in the system.
 */
export type AgentStatus = 'idle' | 'thinking' | 'executing' | 'waiting' | 'error'

/**
 * Agent status information for display.
 */
export interface AgentStatusInfo {
  type: AgentType
  status: AgentStatus
  details?: string
  currentTask?: string
}

/**
 * Per-agent model and API configuration.
 */
export interface AgentSettings {
  /** Model name/identifier */
  model: string
  /** API endpoint URL (OpenAI-compatible) */
  endpoint: string
  /** Optional API key (uses default if not set) */
  apiKey?: string
  /** Maximum tokens for response generation */
  maxTokens: number
  /** Temperature for response randomness (0-2) */
  temperature: number
  /** Request timeout in milliseconds */
  timeout?: number
}

/**
 * Multi-agent system configuration.
 * Supports per-agent model configuration with fallback to defaults.
 */
export interface MultiAgentSettings {
  /** Default settings used when agent-specific settings are not provided */
  defaults: Partial<AgentSettings>
  /** Orchestrator agent settings (recommended: larger model like Devstral 24B) */
  orchestrator?: Partial<AgentSettings>
  /** Editor agent settings (recommended: smaller model like Ministral 8B) */
  editor?: Partial<AgentSettings>
  /** Research agent settings */
  research?: Partial<AgentSettings>
  /** Critique agent settings */
  critique?: Partial<AgentSettings>
  /** Style agent settings */
  style?: Partial<AgentSettings>
  /** Creative director agent settings (recommended: larger model) */
  creative?: Partial<AgentSettings>
}

/**
 * RAG (Retrieval-Augmented Generation) configuration.
 */
export interface RAGSettings {
  /** Whether RAG is enabled */
  enabled: boolean
  /** Embedding configuration */
  embeddings: {
    /** Provider: 'local' uses ONNX, 'api' uses LLM endpoint */
    provider: 'local' | 'api'
    /** Model name for embeddings */
    model: string
  }
  /** Chunking configuration */
  chunking: {
    /** Maximum tokens per chunk */
    maxChunkSize: number
    /** Token overlap between chunks */
    overlap: number
  }
}

/**
 * Model preset for easy configuration.
 */
export interface ModelPreset {
  /** Display name */
  name: string
  /** API endpoint URL */
  endpoint: string
  /** Model identifier */
  model: string
  /** Optional recommended context size */
  contextSize?: number
}

// ============================================================================
// Message Types
// ============================================================================

/**
 * Message between agents in the system.
 */
export interface AgentMessage {
  /** Unique message identifier */
  id: string
  /** Sending agent type */
  from: AgentType | 'user' | 'system'
  /** Target agent type */
  to: AgentType | 'user'
  /** Message content */
  content: string
  /** Optional structured data */
  data?: Record<string, unknown>
  /** Timestamp */
  timestamp: number
  /** Message type for routing */
  type: AgentMessageType
}

/**
 * Types of messages in the agent system.
 */
export type AgentMessageType =
  | 'task'           // Task assignment
  | 'result'         // Task result
  | 'query'          // Information query
  | 'response'       // Query response
  | 'status'         // Status update
  | 'error'          // Error report
  | 'approval'       // Request for user approval

/**
 * Task assigned to an agent.
 */
export interface AgentTask {
  /** Unique task identifier */
  id: string
  /** Task description */
  description: string
  /** Agent assigned to the task */
  agent: AgentType
  /** Task priority (lower = higher priority) */
  priority: number
  /** Task status */
  status: 'pending' | 'in_progress' | 'complete' | 'failed' | 'cancelled'
  /** Parent task ID (for subtasks) */
  parentId?: string
  /** Task context/input data */
  context: Record<string, unknown>
  /** Task result */
  result?: unknown
  /** Error message if failed */
  error?: string
  /** Creation timestamp */
  createdAt: number
  /** Completion timestamp */
  completedAt?: number
}

// ============================================================================
// Edit Format Types
// ============================================================================

/**
 * SEARCH/REPLACE edit block format.
 * Based on Aider's edit format for reliable file modifications.
 */
export interface SearchReplaceEdit {
  /** Target file path */
  file: string
  /** Text to search for (must be unique in file or have enough context) */
  search: string
  /** Text to replace with */
  replace: string
}

/**
 * Result of applying an edit.
 */
export interface EditResult {
  /** Whether the edit was successful */
  success: boolean
  /** Match strategy used */
  matchStrategy?: 'exact' | 'whitespace' | 'fuzzy' | 'anchor'
  /** Error message if failed */
  error?: string
  /** Line number where match was found */
  lineNumber?: number
  /** Similarity score if fuzzy matched (0-1) */
  similarity?: number
}

// ============================================================================
// Context Types
// ============================================================================

/**
 * Context provided to an agent for task execution.
 * Each agent gets its own context window to prevent pollution.
 */
export interface AgentContext {
  /** Agent type */
  agent: AgentType
  /** Maximum tokens for this agent's context */
  maxContextTokens: number
  /** Current token count */
  currentTokens: number
  /** System prompt for the agent */
  systemPrompt: string
  /** Conversation history (scoped to this agent) */
  messages: AgentContextMessage[]
  /** Available tools for this agent */
  tools: string[]
  /** Workspace folders for file operations */
  workspaceFolders: string[]
  /** Currently relevant files (from RAG or explicit) */
  relevantFiles: RelevantFile[]
}

/**
 * A message in an agent's context.
 */
export interface AgentContextMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  /** Token count for this message */
  tokens: number
}

/**
 * A file relevant to the current task.
 */
export interface RelevantFile {
  /** File path */
  path: string
  /** Why this file is relevant */
  reason: string
  /** Relevant sections/snippets */
  snippets?: FileSnippet[]
  /** Relevance score (0-1) */
  score: number
}

/**
 * A snippet from a file.
 */
export interface FileSnippet {
  /** Starting line number */
  startLine: number
  /** Ending line number */
  endLine: number
  /** Snippet content */
  content: string
  /** Heading context (markdown files) */
  headingContext?: string
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * Events emitted by the agent system.
 */
export interface AgentSystemEvents {
  /** Agent status changed */
  'agent:status': { agent: AgentType; status: AgentStatus; details?: string }
  /** Task created */
  'task:created': { task: AgentTask }
  /** Task updated */
  'task:updated': { task: AgentTask }
  /** Task completed */
  'task:completed': { task: AgentTask }
  /** Message sent between agents */
  'message:sent': { message: AgentMessage }
  /** Edit proposed by editor agent */
  'edit:proposed': { edit: SearchReplaceEdit; taskId: string }
  /** Edit applied */
  'edit:applied': { edit: SearchReplaceEdit; result: EditResult }
  /** RAG query performed */
  'rag:query': { query: string; results: RelevantFile[] }
  /** Error occurred */
  'error': { agent: AgentType; error: string; taskId?: string }
}

/**
 * Event handler type for agent system events.
 */
export type AgentEventHandler<T extends keyof AgentSystemEvents> = (
  data: AgentSystemEvents[T]
) => void
