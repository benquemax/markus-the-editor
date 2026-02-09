/**
 * Thought Loop Types
 *
 * Core type definitions for the refactored Markus thought loop.
 * This architecture separates raw logging (for debugging) from
 * context building (for LLM requests) using algorithmic context fabrication.
 *
 * Key principle: Store all data structured, build each LLM request context
 * algorithmically by cherry-picking relevant data.
 */

import type { Task, BlockingToolUI, ToolDefinition } from '../types'

// ============================================================================
// Core Conversation Log Types
// ============================================================================

/**
 * The main conversation log structure.
 * Replaces the old Conversation format with a structured approach
 * that supports algorithmic context fabrication.
 */
export interface ConversationLog {
  id: string
  filebarId: string
  title: string
  mode: 'planning' | 'execution'

  /** All user messages (original requests + ask_user responses) */
  userMessages: UserMessage[]

  /** All thought loop iterations (for debugging and context building) */
  iterations: ThoughtIteration[]

  /** Current task list state */
  tasks: TaskState

  /** Metadata for debugging */
  metadata: ConversationMetadata

  createdAt: number
  updatedAt: number
}

/**
 * A user message in the conversation.
 * Includes both original user requests and responses to ask_user prompts.
 */
export interface UserMessage {
  id: string
  content: string
  timestamp: number
  /** If this is a response to ask_user, the original question */
  inResponseTo?: {
    question: string
    options?: string[]
  }
}

/**
 * Current state of the task list.
 * Extracted to allow easy injection into context.
 */
export interface TaskState {
  tasks: Task[]
  updatedAt: number
}

/**
 * Metadata for debugging and analytics.
 */
export interface ConversationMetadata {
  /** Total LLM tokens used (estimated) */
  totalTokens?: number
  /** Total iterations across all requests */
  totalIterations: number
  /** Number of times context was condensed */
  condensationCount: number
  /** Last error if any */
  lastError?: string
}

// ============================================================================
// Thought Iteration Types
// ============================================================================

/**
 * A single thought loop iteration (one LLM request/response cycle).
 * Contains all data for debugging and context replay.
 */
export interface ThoughtIteration {
  id: string
  index: number
  mode: 'planning' | 'execution'

  /** What was actually sent to LLM (for debugging) */
  request: LLMRequestContext

  /** LLM response */
  response: LLMResponseData

  /** Tool calls made during this iteration */
  toolCalls: ToolCallLog[]

  /** Timing information */
  timing: IterationTiming

  /** How this iteration ended */
  endState: IterationEndState
}

/**
 * Context sent to the LLM for a request.
 * Stored for debugging - shows exactly what the LLM saw.
 */
export interface LLMRequestContext {
  /** System prompt sent */
  systemPrompt: string

  /** Messages array sent to LLM */
  messages: LLMContextMessage[]

  /** Sources that contributed to this context */
  contextSources: ContextSource[]

  /** Estimated token count */
  estimatedTokens?: number
}

/**
 * A message in the LLM context (simplified for logging).
 */
export interface LLMContextMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  /** For debugging: what contributed to this message */
  source?: string
}

/**
 * Describes where context data came from.
 * Useful for debugging context composition.
 */
export interface ContextSource {
  type: ContextSourceType
  /** File path for file reads, iteration ID for summaries, etc. */
  reference?: string
  /** Character count contributed */
  charCount: number
  /** Whether this was truncated */
  truncated?: boolean
}

export type ContextSourceType =
  | 'system_prompt'
  | 'mode_instructions'
  | 'user_message'
  | 'consult_boss'
  | 'file_read'
  | 'task_list'
  | 'memory'
  | 'iteration_summary'
  | 'tool_result'

/**
 * Response data from the LLM.
 */
export interface LLMResponseData {
  /** Raw content from LLM */
  rawContent: string

  /** Content after stripping reasoning (what's shown to internal log) */
  strippedContent: string

  /** Parsed tool calls */
  parsedToolCalls: ParsedToolCallData[]

  /** Whether response contained valid tool calls */
  hasToolCalls: boolean

  /** Model used */
  model?: string

  /** Token usage if available */
  tokens?: {
    prompt?: number
    completion?: number
    total?: number
  }
}

/**
 * Parsed tool call data for logging.
 */
export interface ParsedToolCallData {
  id: string
  name: string
  arguments: Record<string, unknown>
}

/**
 * Timing information for an iteration.
 */
export interface IterationTiming {
  startedAt: number
  llmCompletedAt?: number
  toolsCompletedAt?: number
  endedAt: number
}

/**
 * How an iteration ended.
 */
export type IterationEndState =
  | { type: 'continue' }
  | { type: 'blocking_tool'; toolName: string; toolCallId: string }
  | { type: 'max_iterations' }
  | { type: 'max_no_tool_retries'; retryCount: number }
  | { type: 'repetition_detected' }
  | { type: 'all_rejected' }
  | { type: 'user_cancelled' }
  | { type: 'error'; message: string }

// ============================================================================
// Tool Call Log Types
// ============================================================================

/**
 * Complete log of a tool call with cached results.
 */
export interface ToolCallLog {
  id: string
  name: string
  arguments: Record<string, unknown>
  status: ToolCallStatus
  startedAt: number
  completedAt?: number

  /** Result of the tool execution */
  result?: ToolCallResult

  /** For file reads, cache content for context reuse */
  cachedContent?: string

  /** Whether this tool blocks the loop */
  blocking: boolean

  /** UI data for blocking tools */
  uiData?: BlockingToolUI
}

export type ToolCallStatus =
  | 'pending'
  | 'executing'
  | 'complete'
  | 'error'
  | 'rejected'

export interface ToolCallResult {
  success: boolean
  data?: unknown
  error?: string
}

// ============================================================================
// Loop Controller Types
// ============================================================================

/**
 * Current state of the loop controller.
 */
export type LoopState =
  | 'idle'
  | 'thinking'
  | 'executing'
  | 'blocked'
  | 'done'

/**
 * Stop condition that ended the loop.
 */
export type StopCondition =
  | 'blocking_tool'
  | 'max_iterations'
  | 'max_no_tool_retries'
  | 'repetition_detected'
  | 'user_cancelled'
  | 'all_rejected'
  | 'error'

/**
 * Configuration for the loop controller.
 */
export interface LoopConfig {
  maxIterations: number
  maxNoToolRetries: number
}

export const DEFAULT_LOOP_CONFIG: LoopConfig = {
  maxIterations: 30,
  maxNoToolRetries: 3
}

// ============================================================================
// Context Builder Types
// ============================================================================

/**
 * Options for building context.
 */
export interface ContextBuildOptions {
  mode: 'planning' | 'execution'

  /** Current task state */
  tasks: TaskState

  /** Maximum context tokens (approximate) */
  maxTokens?: number

  /** Whether to include full file contents or just summaries */
  fullFileContents?: boolean

  /** Custom tool definitions for orchestrator mode (overrides global TOOL_DEFINITIONS) */
  toolDefinitions?: ToolDefinition[]

  /** Agent definitions for system prompt generation */
  agentDefinitions?: Array<{
    slug: string
    name: string
    description: string
    whenToUse: string
  }>
}

/**
 * Result of context building.
 */
export interface BuiltContext {
  /** Messages to send to LLM */
  messages: LLMContextMessage[]

  /** System prompt */
  systemPrompt: string

  /** Sources for debugging */
  sources: ContextSource[]

  /** Estimated token count */
  estimatedTokens: number
}

// ============================================================================
// File Cache Types
// ============================================================================

/**
 * Cached file content for context reuse.
 */
export interface FileCache {
  /** File path → content mapping */
  files: Map<string, CachedFile>
}

export interface CachedFile {
  path: string
  content: string
  /** Iteration when this was read */
  readAtIteration: number
  /** Timestamp of read */
  readAt: number
  /** Character count */
  charCount: number
}

// ============================================================================
// Event Types (for UI updates)
// ============================================================================

/**
 * Events emitted during thought loop execution.
 */
export type ThoughtLoopEvent =
  | { type: 'iteration_started'; iterationIndex: number }
  | { type: 'llm_streaming'; chunk: string }
  | { type: 'llm_complete'; response: LLMResponseData }
  | { type: 'tool_started'; toolCall: ToolCallLog }
  | { type: 'tool_complete'; toolCallId: string; result: ToolCallResult }
  | { type: 'iteration_complete'; iteration: ThoughtIteration }
  | { type: 'loop_blocked'; reason: string; uiData?: BlockingToolUI }
  | { type: 'loop_complete'; stopCondition: StopCondition }
  | { type: 'error'; message: string }

/**
 * Handler for thought loop events.
 */
export type ThoughtLoopEventHandler = (event: ThoughtLoopEvent) => void
