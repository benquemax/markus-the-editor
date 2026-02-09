/**
 * Multi-Agent System Integration
 *
 * Main integration module that coordinates the multi-agent system.
 * Supports two modes:
 * 1. Global mode (settings.yaml) - Backward-compatible singleton with hardcoded agent types
 * 2. Per-conversation mode (API-defined) - Each conversation gets its own agent set
 *    with instruction-driven behavior from AgentDefinitions
 */

import {
  AgentRouter,
  getAgentRouter,
  resetAgentRouter,
  agentEventBus,
  agentContextManager,
  AgentTask,
  AgentType,
  AgentSettings,
  AgentStatusInfo
} from './agents'
import {
  OrchestratorAgent,
  createOrchestratorAgent
} from './agents/orchestrator'
import { EditorAgent, createEditorAgent } from './agents/editor'
import { ResearchAgent, createResearchAgent } from './agents/research'
import { CritiqueAgent, createCritiqueAgent } from './agents/critique'
import { StyleAgent, createStyleAgent } from './agents/style'
import { CreativeAgent, createCreativeAgent } from './agents/creative'
import { GenericAgent, createGenericAgent, AgentDefinition } from './agents/generic'
import { MarkusSettings } from './types'
import { getAgentSettings, getRAGSettings, getConfigDir } from './settings'
import { getIndexManager, resetIndexManager, IndexManager, IndexStatus } from './rag'

// Re-export AgentDefinition for external consumers
export type { AgentDefinition } from './agents/generic'

// ============================================================================
// Types
// ============================================================================

/**
 * Multi-agent system state (used for both global and per-conversation).
 */
interface MultiAgentState {
  /** Whether the system is initialized */
  initialized: boolean
  /** Agent router */
  router: AgentRouter | null
  /** RAG index manager */
  indexManager: IndexManager | null
  /** Current workspace folders */
  workspaceFolders: string[]
  /** Current settings */
  settings: MarkusSettings | null
  /** GenericAgent instances for per-conversation mode */
  agents?: GenericAgent[]
}

// ============================================================================
// Global State (backward-compatible settings.yaml mode)
// ============================================================================

const state: MultiAgentState = {
  initialized: false,
  router: null,
  indexManager: null,
  workspaceFolders: [],
  settings: null
}

// ============================================================================
// Per-Conversation State (API-defined agent mode)
// ============================================================================

const conversationStates = new Map<string, MultiAgentState>()

// ============================================================================
// Global Initialization (settings.yaml)
// ============================================================================

/**
 * Initialize the multi-agent system from settings.yaml.
 * This is the backward-compatible path using hardcoded agent types.
 */
export async function initializeMultiAgentSystem(
  settings: MarkusSettings,
  workspaceFolders: string[]
): Promise<void> {
  if (state.initialized) {
    console.log('[MultiAgent] Already initialized')
    return
  }

  console.log('[MultiAgent] Initializing multi-agent system...')
  state.settings = settings
  state.workspaceFolders = workspaceFolders

  // Update context manager with workspace folders
  agentContextManager.setWorkspaceFolders(workspaceFolders)

  // Get multi-agent settings
  const agentSettings = settings.agents || {
    defaults: {
      model: settings.llm.model,
      endpoint: settings.llm.apiEndpoint,
      apiKey: settings.llm.apiKey,
      maxTokens: settings.llm.maxTokens || 4096,
      temperature: settings.llm.temperature || 0.7
    }
  }

  // Create and initialize the router
  state.router = getAgentRouter(agentSettings)

  // Create all agents
  const agents = createAllAgents(settings, workspaceFolders)

  // Register agents with router
  for (const agent of agents) {
    state.router.registerAgent(agent)
  }

  // Set up orchestrator with router reference
  const orchestrator = agents.find(a => a.type === 'orchestrator') as OrchestratorAgent
  if (orchestrator) {
    orchestrator.setRouter(state.router)
  }

  // Initialize RAG if enabled
  const ragSettings = getRAGSettings(settings)
  if (ragSettings.enabled) {
    const configDir = getConfigDir()
    state.indexManager = getIndexManager(ragSettings, configDir)
    await state.indexManager.initialize(workspaceFolders)

    // Start background indexing
    state.indexManager.indexWorkspace().catch(err => {
      console.error('[MultiAgent] RAG indexing error:', err)
    })
  }

  state.initialized = true
  console.log('[MultiAgent] Multi-agent system initialized')
}

/**
 * Create all hardcoded agent instances (settings.yaml path).
 */
function createAllAgents(
  settings: MarkusSettings,
  workspaceFolders: string[]
): Array<OrchestratorAgent | EditorAgent | ResearchAgent | CritiqueAgent | StyleAgent | CreativeAgent> {
  const agents: Array<OrchestratorAgent | EditorAgent | ResearchAgent | CritiqueAgent | StyleAgent | CreativeAgent> = []

  // Orchestrator (larger model recommended)
  const orchestratorSettings = getAgentSettings(settings, 'orchestrator')
  agents.push(createOrchestratorAgent(orchestratorSettings, workspaceFolders))

  // Editor (small model, low temperature)
  const editorSettings = getAgentSettings(settings, 'editor')
  agents.push(createEditorAgent(editorSettings, workspaceFolders))

  // Research
  const researchSettings = getAgentSettings(settings, 'research')
  agents.push(createResearchAgent(researchSettings, workspaceFolders))

  // Critique
  const critiqueSettings = getAgentSettings(settings, 'critique')
  agents.push(createCritiqueAgent(critiqueSettings, workspaceFolders))

  // Style
  const styleSettings = getAgentSettings(settings, 'style')
  agents.push(createStyleAgent(styleSettings, workspaceFolders))

  // Creative (larger model recommended)
  const creativeSettings = getAgentSettings(settings, 'creative')
  agents.push(createCreativeAgent(creativeSettings, workspaceFolders))

  return agents
}

// ============================================================================
// Per-Conversation Initialization (API-defined agents)
// ============================================================================

/**
 * Initialize the multi-agent system for a specific conversation
 * using API-defined agent definitions.
 *
 * Each conversation gets its own router, agents, and state —
 * completely isolated from other conversations and the global state.
 */
export async function initializeForConversation(
  conversationId: string,
  agentDefinitions: AgentDefinition[],
  settings: MarkusSettings,
  workspaceFolders: string[]
): Promise<void> {
  if (conversationStates.has(conversationId)) {
    console.log(`[MultiAgent] Conversation ${conversationId} already initialized`)
    return
  }

  console.log(`[MultiAgent] Initializing per-conversation agents for ${conversationId}...`)

  // Build router settings from the first agent's defaults
  // (the router needs MultiAgentSettings, but for API-defined agents
  // we just need a minimal defaults block)
  const routerSettings = {
    defaults: {
      model: settings.llm.model,
      endpoint: settings.llm.apiEndpoint,
      apiKey: settings.llm.apiKey,
      maxTokens: settings.llm.maxTokens || 4096,
      temperature: settings.llm.temperature || 0.7
    }
  }

  // Create a fresh router for this conversation (not the global singleton)
  const router = new AgentRouter(routerSettings)

  // Create generic agents from definitions
  const agents: GenericAgent[] = []
  for (const def of agentDefinitions) {
    const agentSettings: AgentSettings = {
      model: def.model,
      endpoint: def.endpoint,
      apiKey: def.apiKey,
      maxTokens: def.maxTokens,
      temperature: def.temperature,
      timeout: def.timeout
    }

    const agent = createGenericAgent(
      def.slug,
      def.name,
      def.roleDefinition,
      def.customInstructions,
      agentSettings,
      workspaceFolders,
      def.tools
    )
    agents.push(agent)
    router.registerAgent(agent)
  }

  // Store per-conversation state (including agents for orchestrator tool building)
  const convState: MultiAgentState = {
    initialized: true,
    router,
    indexManager: null,
    workspaceFolders,
    settings,
    agents
  }

  // Initialize RAG for this conversation if enabled
  const ragSettings = getRAGSettings(settings)
  if (ragSettings.enabled) {
    const configDir = getConfigDir()
    convState.indexManager = getIndexManager(ragSettings, configDir)
    await convState.indexManager.initialize(workspaceFolders)

    convState.indexManager.indexWorkspace().catch(err => {
      console.error(`[MultiAgent] RAG indexing error (conv ${conversationId}):`, err)
    })
  }

  conversationStates.set(conversationId, convState)
  console.log(`[MultiAgent] Per-conversation agents initialized for ${conversationId} (${agents.length} agents)`)
}

/**
 * Shutdown the multi-agent system for a specific conversation.
 */
export function shutdownConversation(conversationId: string): void {
  const convState = conversationStates.get(conversationId)
  if (!convState) return

  if (convState.router) {
    convState.router.shutdown()
  }

  if (convState.indexManager) {
    convState.indexManager.save().catch(err => {
      console.error(`[MultiAgent] Failed to save RAG index (conv ${conversationId}):`, err)
    })
  }

  conversationStates.delete(conversationId)
  console.log(`[MultiAgent] Conversation ${conversationId} shutdown`)
}

/**
 * Check if a specific conversation has per-conversation agents initialized.
 */
export function isInitializedForConversation(conversationId: string): boolean {
  return conversationStates.get(conversationId)?.initialized ?? false
}

/**
 * Get the GenericAgent instances for a conversation.
 * Returns empty array if conversation not initialized or has no agents.
 */
export function getConversationAgents(conversationId: string): GenericAgent[] {
  return conversationStates.get(conversationId)?.agents ?? []
}

// ============================================================================
// Global Shutdown
// ============================================================================

/**
 * Shutdown the multi-agent system.
 */
export function shutdownMultiAgentSystem(): void {
  if (state.router) {
    state.router.shutdown()
    resetAgentRouter()
    state.router = null
  }

  if (state.indexManager) {
    state.indexManager.save().catch(err => {
      console.error('[MultiAgent] Failed to save RAG index:', err)
    })
    resetIndexManager()
    state.indexManager = null
  }

  // Also shutdown all per-conversation states
  for (const [convId] of conversationStates) {
    shutdownConversation(convId)
  }

  state.initialized = false
  state.settings = null
  state.workspaceFolders = []

  console.log('[MultiAgent] Multi-agent system shutdown')
}

// ============================================================================
// Workspace Management
// ============================================================================

/**
 * Update workspace folders.
 */
export async function updateWorkspaceFolders(folders: string[]): Promise<void> {
  state.workspaceFolders = folders
  agentContextManager.setWorkspaceFolders(folders)

  // Re-initialize RAG if needed
  if (state.indexManager && state.settings) {
    await state.indexManager.initialize(folders)
    state.indexManager.indexWorkspace().catch(err => {
      console.error('[MultiAgent] RAG re-indexing error:', err)
    })
  }
}

// ============================================================================
// Task Routing
// ============================================================================

/**
 * Route a user message to the multi-agent system.
 */
export async function routeUserMessage(
  message: string,
  context: Record<string, unknown> = {}
): Promise<AgentTask | null> {
  if (!state.router) {
    console.error('[MultiAgent] System not initialized')
    return null
  }

  return state.router.routeUserMessage(message, {
    ...context,
    workspaceFolders: state.workspaceFolders
  })
}

/**
 * Cancel a task.
 */
export function cancelTask(taskId: string): void {
  if (state.router) {
    state.router.cancelTask(taskId)
  }
}

/**
 * Cancel all tasks.
 */
export function cancelAllTasks(): void {
  if (state.router) {
    state.router.cancelAll()
  }
}

/**
 * Get task status.
 */
export function getTaskStatus(taskId: string): AgentTask | undefined {
  if (state.router) {
    return state.router.getTaskStatus(taskId)
  }
  return undefined
}

// ============================================================================
// Status Queries
// ============================================================================

/**
 * Get status of all agents.
 */
export function getAgentStatuses(): AgentStatusInfo[] {
  if (!state.router) {
    return []
  }

  return state.router.getAgentStatuses().map(s => ({
    type: s.type,
    status: s.status as AgentStatusInfo['status']
  }))
}

/**
 * Get RAG index status.
 */
export function getRAGIndexStatus(): IndexStatus | null {
  if (state.indexManager) {
    return state.indexManager.getStatus()
  }
  return null
}

/**
 * Trigger RAG reindex.
 */
export async function reindexWorkspace(): Promise<void> {
  if (state.indexManager) {
    await state.indexManager.indexWorkspace()
  }
}

/**
 * Check if multi-agent system is initialized.
 */
export function isInitialized(): boolean {
  return state.initialized
}

// ============================================================================
// Event Subscriptions
// ============================================================================

/**
 * Subscribe to agent status changes.
 */
export function onAgentStatusChange(
  callback: (data: { agent: AgentType; status: string; details?: string }) => void
): () => void {
  return agentEventBus.on('agent:status', callback)
}

/**
 * Subscribe to task creation.
 */
export function onTaskCreated(
  callback: (data: { task: AgentTask }) => void
): () => void {
  return agentEventBus.on('task:created', callback)
}

/**
 * Subscribe to task completion.
 */
export function onTaskCompleted(
  callback: (data: { task: AgentTask }) => void
): () => void {
  return agentEventBus.on('task:completed', callback)
}

/**
 * Subscribe to errors.
 */
export function onError(
  callback: (data: { agent: AgentType; error: string; taskId?: string }) => void
): () => void {
  return agentEventBus.on('error', callback)
}

// ============================================================================
// RAG Search
// ============================================================================

/**
 * Perform semantic search in the RAG index.
 */
export async function searchRAG(
  query: string,
  limit: number = 10
): Promise<Array<{
  filePath: string
  content: string
  score: number
  startLine: number
  endLine: number
}>> {
  if (!state.indexManager) {
    return []
  }

  const results = await state.indexManager.search(query, limit)

  return results.map(r => ({
    filePath: r.document.filePath,
    content: r.document.content,
    score: r.score,
    startLine: r.document.metadata.startLine,
    endLine: r.document.metadata.endLine
  }))
}
