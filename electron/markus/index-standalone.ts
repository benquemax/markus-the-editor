/**
 * Standalone Entry Point for Markus Core
 *
 * This file exports all the modules needed by the standalone server.
 * It's bundled by esbuild to create a single importable module that
 * works without Vite's bundler resolution.
 */

// Types
export type {
  LLMSettings,
  ToolDefinition,
  ToolResult,
  ToolContext,
  Task,
  TaskList,
  BlockingToolUI,
  MarkusSettings
} from './types'

export type {
  ConversationLog,
  ThoughtIteration,
  ToolCallLog,
  ToolCallResult,
  StopCondition,
  ThoughtLoopEvent,
  ThoughtLoopEventHandler
} from './thoughtLoop/types'

export type { EventTransport } from './transport/types'

export type { LoopControllerOptions } from './thoughtLoop/loopController'
export type { AgentPromptInfo } from './thoughtLoop/contextBuilder'

// LLM client
export { createLLMClient } from './llm'

// Tool definitions and executor
export { TOOL_DEFINITIONS, executeTool, buildOrchestratorTools } from './tools'

// Thought loop - re-export everything from the index
export {
  // Log manager
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
  getBlockingToolCall,
  // Context builder
  buildSystemPrompt,
  buildContext,
  buildInitialContext,
  contextToLLMMessages,
  createRequestContext,
  // Loop controller
  LoopController,
  runThoughtLoop,
  // Migrator
  isOldFormat,
  isNewFormat,
  migrateConversation,
  ensureNewFormat,
  convertToOldFormat,
  getDisplayMessages,
  // Constants
  DEFAULT_LOOP_CONFIG
} from './thoughtLoop/index'

// Task management
export {
  loadTaskList,
  createTaskList,
  saveTaskList,
  addTask,
  updateTaskStatus,
  removeTask,
  formatTaskListForPrompt
} from './tasks'

// Conversations
export {
  getFilebarId
} from './conversations'

// Settings
export {
  readSettings,
  writeSettings,
  getConfigDir,
  getSettingsPath,
  ensureSettingsFile,
  validateSettings,
  getAgentSettings,
  getRAGSettings,
  isMultiAgentEnabled
} from './settings'

// Multi-agent system
export {
  initializeMultiAgentSystem,
  initializeForConversation,
  shutdownMultiAgentSystem,
  shutdownConversation,
  isInitialized as isMultiAgentInitialized,
  isInitializedForConversation,
  getConversationAgents
} from './multiAgent'

export type { AgentDefinition } from './multiAgent'

// Tool presets for generic agents
export { TOOL_PRESETS, DEFAULT_TOOLS } from './agents/generic'

