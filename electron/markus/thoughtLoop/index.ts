/**
 * Thought Loop Module
 *
 * Exports all types and functions for the refactored Markus thought loop
 * with algorithmic context fabrication.
 *
 * Architecture:
 * - types.ts: Core type definitions for ConversationLog, iterations, etc.
 * - logManager.ts: Log persistence layer (save/load JSON)
 * - contextBuilder.ts: Algorithmic context fabrication for LLM requests
 * - loopController.ts: State machine for thought loop control
 * - migrator.ts: Migration from old Conversation format
 */

// Re-export types
export type {
  // Core types
  ConversationLog,
  UserMessage,
  TaskState,
  ConversationMetadata,

  // Iteration types
  ThoughtIteration,
  LLMRequestContext,
  LLMContextMessage,
  ContextSource,
  ContextSourceType,
  LLMResponseData,
  ParsedToolCallData,
  IterationTiming,
  IterationEndState,

  // Tool call types
  ToolCallLog,
  ToolCallStatus,
  ToolCallResult,

  // Loop controller types
  LoopState,
  StopCondition,
  LoopConfig,

  // Context builder types
  ContextBuildOptions,
  BuiltContext,

  // File cache types
  FileCache,
  CachedFile,

  // Event types
  ThoughtLoopEvent,
  ThoughtLoopEventHandler
} from './types'

export { DEFAULT_LOOP_CONFIG } from './types'

// Re-export log manager functions
export {
  createLog,
  saveLog,
  loadLog,
  deleteLog,
  listLogs,
  addUserMessage,
  addIteration,
  updateTasks,
  setError,
  setMode,
  getConsultBossMessages,
  getFileReadCache,
  getRecentIterations,
  summarizeIteration,
  estimateTokens,
  getBlockingToolCall
} from './logManager'

// Re-export context builder functions
export {
  buildSystemPrompt,
  buildContext,
  buildInitialContext,
  contextToLLMMessages,
  createRequestContext
} from './contextBuilder'
export type { AgentPromptInfo } from './contextBuilder'

// Re-export loop controller
export {
  LoopController,
  runThoughtLoop
} from './loopController'
export type { LoopControllerOptions } from './loopController'

// Re-export migrator functions
export {
  isOldFormat,
  isNewFormat,
  migrateConversation,
  ensureNewFormat,
  convertToOldFormat,
  getDisplayMessages
} from './migrator'
