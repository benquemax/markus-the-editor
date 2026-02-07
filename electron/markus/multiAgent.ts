/**
 * Multi-Agent System Integration
 *
 * Main integration module that coordinates the multi-agent system.
 * Handles agent initialization, task routing, and communication with
 * the existing Markus IPC handlers.
 */

import {
  AgentRouter,
  getAgentRouter,
  resetAgentRouter,
  agentEventBus,
  agentContextManager,
  AgentTask,
  AgentType,
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
import { MarkusSettings } from './types'
import { getAgentSettings, getRAGSettings, getConfigDir } from './settings'
import { getIndexManager, resetIndexManager, IndexManager, IndexStatus } from './rag'

// ============================================================================
// Types
// ============================================================================

/**
 * Multi-agent system state.
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
}

// ============================================================================
// State
// ============================================================================

const state: MultiAgentState = {
  initialized: false,
  router: null,
  indexManager: null,
  workspaceFolders: [],
  settings: null
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the multi-agent system.
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
 * Create all agent instances.
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
