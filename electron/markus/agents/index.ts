/**
 * Multi-Agent System Module
 *
 * Exports all agent-related types, classes, and utilities.
 * This module provides the infrastructure for the multi-agent architecture
 * optimized for small local models.
 */

// Types
export * from './types'
export type { AgentStatusInfo } from './types'

// Event Bus
export { AgentEventBus, agentEventBus } from './eventBus'

// Context Manager
export { AgentContextManager, agentContextManager } from './contextManager'

// Base Agent
export { BaseAgent, DEFAULT_AGENT_SETTINGS, mergeAgentSettings } from './base'

// Router
export {
  AgentRegistry,
  TaskQueue,
  AgentRouter,
  getAgentRouter,
  resetAgentRouter
} from './router'

// Specialist Agents
export { OrchestratorAgent, createOrchestratorAgent } from './orchestrator'
export { ResearchAgent, createResearchAgent } from './research'
export { CritiqueAgent, createCritiqueAgent, parseReviewIssues, type ReviewIssue } from './critique'
export { StyleAgent, createStyleAgent, parseStyleIssues, type StyleIssue } from './style'
export { CreativeAgent, createCreativeAgent, parseIdeas, type CreativeIdea } from './creative'

// Editor Agent (from submodule)
export {
  EditorAgent,
  createEditorAgent,
  parseEdits,
  findMatch,
  validateEdit,
  applyEdit
} from './editor'

// Generic Agent (instruction-driven, for API-defined agents)
export {
  GenericAgent,
  createGenericAgent,
  TOOL_PRESETS,
  DEFAULT_TOOLS,
  type AgentDefinition
} from './generic'
