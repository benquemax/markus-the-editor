/**
 * WebSocket Handler
 *
 * Manages WebSocket connections and message handling.
 * Integrates with the Markus thought loop for AI processing.
 */

import { WebSocketServer, WebSocket, RawData } from 'ws'
import { URL } from 'url'
import type { ConversationManager } from '../conversationManager'
import type { ClientMessage } from '../types'
import { WebSocketTransport } from './transport'
import { readSettings, validateSettings, ensureDirectories } from '../settings'

// Core imports - these use relative paths to electron/markus
import {
  createLog,
  saveLog,
  loadLog,
  addUserMessage,
  runThoughtLoop,
  loadTaskList,
  createTaskList,
  getWorkspaceId,
  isMultiAgentEnabled,
  isMultiAgentInitialized,
  initializeMultiAgentSystem,
  initializeForConversation,
  shutdownConversation,
  isInitializedForConversation,
  getConversationAgents,
  buildOrchestratorTools
} from '../core/index'
import type { ConversationLog, ThoughtLoopEvent, AgentPromptInfo } from '../core/index'

/**
 * Active WebSocket connections per conversation.
 */
const connectionsByConversation = new Map<string, Set<WebSocketTransport>>()

/**
 * Active conversation logs (in-memory cache).
 */
const activeConversationLogs = new Map<string, ConversationLog>()

/**
 * Sets up WebSocket connection handling.
 */
export function setupWebSocketHandler(
  wss: WebSocketServer,
  conversationManager: ConversationManager
): void {
  wss.on('connection', (ws: WebSocket, request) => {
    // Parse conversation ID from query string
    const url = new URL(request.url || '', `http://${request.headers.host}`)
    const conversationId = url.searchParams.get('conversationId')

    if (!conversationId) {
      console.warn('[WebSocket] Connection rejected - no conversationId provided')
      ws.close(4000, 'conversationId query parameter required')
      return
    }

    // Verify conversation exists
    const conversation = conversationManager.get(conversationId)
    if (!conversation) {
      console.warn(`[WebSocket] Connection rejected - conversation ${conversationId} not found`)
      ws.close(4004, 'Conversation not found')
      return
    }

    console.log(`[WebSocket] Client connected to conversation ${conversationId}`)

    // Create transport for this connection
    const transport = new WebSocketTransport(ws, conversationId)

    // Track connection
    if (!connectionsByConversation.has(conversationId)) {
      connectionsByConversation.set(conversationId, new Set())
    }
    connectionsByConversation.get(conversationId)!.add(transport)

    // Handle incoming messages
    ws.on('message', async (data: RawData) => {
      try {
        const message = JSON.parse(data.toString()) as ClientMessage
        await handleMessage(message, transport, conversationManager)
      } catch (error) {
        console.error('[WebSocket] Error handling message:', error)
        transport.sendError(error instanceof Error ? error.message : 'Unknown error')
      }
    })

    // Handle connection close
    ws.on('close', () => {
      console.log(`[WebSocket] Client disconnected from conversation ${conversationId}`)

      // Cancel any pending operations
      transport.cancelAll()

      // Remove from tracking
      const connections = connectionsByConversation.get(conversationId)
      if (connections) {
        connections.delete(transport)
        if (connections.size === 0) {
          connectionsByConversation.delete(conversationId)

          // Shutdown per-conversation agents when the last client disconnects
          if (isInitializedForConversation(conversationId)) {
            shutdownConversation(conversationId)
          }
        }
      }
    })

    // Handle errors
    ws.on('error', (error) => {
      console.error(`[WebSocket] Error on conversation ${conversationId}:`, error)
    })
  })
}

/**
 * Handles an incoming WebSocket message.
 */
async function handleMessage(
  message: ClientMessage,
  transport: WebSocketTransport,
  conversationManager: ConversationManager
): Promise<void> {
  const conversationId = transport.getConversationId()

  switch (message.type) {
    case 'message':
      await handleChatMessage(
        conversationId,
        message.content,
        message.planningMode,
        message.yoloMode,
        transport,
        conversationManager
      )
      break

    case 'tool_response':
      // User responded to a blocking tool (ask_user, approval)
      // Resume the thought loop with the response as context
      const convInfo = conversationManager.get(conversationId)
      if (!convInfo) {
        transport.sendError('Conversation not found')
        break
      }

      // Get stored mode settings
      const modes = conversationManager.getModes(conversationId)

      // Format the response as a user message to continue the conversation
      const responseContent = typeof message.response === 'boolean'
        ? (message.response ? '[Approved]' : '[Rejected]')
        : `[User Response] ${message.response}`

      // Resume the thought loop
      await handleChatMessage(
        conversationId,
        responseContent,
        modes?.planningMode ?? true,
        modes?.yoloMode ?? false,
        transport,
        conversationManager
      )
      break

    case 'cancel':
      // Cancel the current request
      const cancelled = conversationManager.cancelRequest(conversationId)
      if (cancelled) {
        transport.cancelAll()
        transport.sendComplete(false)
      }
      break

    default:
      console.warn('[WebSocket] Unknown message type:', (message as { type: string }).type)
  }
}

/**
 * Handles a chat message from the client.
 * Runs the full thought loop for AI processing.
 */
async function handleChatMessage(
  conversationId: string,
  content: string,
  planningMode: boolean,
  yoloMode: boolean,
  transport: WebSocketTransport,
  conversationManager: ConversationManager
): Promise<void> {
  // Check if already processing
  if (conversationManager.isProcessing(conversationId)) {
    transport.sendError('A request is already in progress')
    return
  }

  const conversation = conversationManager.get(conversationId)
  if (!conversation) {
    transport.sendError('Conversation not found')
    return
  }

  console.log(`[WebSocket] Processing message for ${conversationId}:`, {
    content: content.substring(0, 100),
    planningMode,
    yoloMode
  })

  // Store mode settings for resumption after blocking tools
  conversationManager.setModes(conversationId, planningMode, yoloMode)

  // Ensure directories exist
  await ensureDirectories()

  // Load settings
  const settings = await readSettings()
  const validation = validateSettings(settings)

  if (!validation.valid) {
    transport.sendError(`Invalid settings: ${validation.errors.join(', ')}`)
    return
  }

  const workspaceFolders = conversation.workspaceFolders
  const workspaceId = getWorkspaceId(workspaceFolders)

  // Lazy-initialize multi-agent system:
  // 1. Per-conversation agents (from API-defined agent definitions) take priority
  // 2. Falls back to global settings.yaml multi-agent config
  const agentDefs = conversationManager.getAgentDefinitions(conversationId)
  if (agentDefs && agentDefs.length > 0) {
    if (!isInitializedForConversation(conversationId)) {
      try {
        await initializeForConversation(conversationId, agentDefs, settings as any, workspaceFolders)
        console.log(`[WebSocket] Per-conversation agents initialized for ${conversationId}`)
      } catch (error) {
        console.warn(`[WebSocket] Failed to initialize per-conversation agents:`, error)
      }
    }
  } else if (isMultiAgentEnabled(settings) && !isMultiAgentInitialized()) {
    try {
      await initializeMultiAgentSystem(settings as any, workspaceFolders)
      console.log('[WebSocket] Multi-agent system initialized')
    } catch (error) {
      console.warn('[WebSocket] Failed to initialize multi-agent system:', error)
    }
  }

  // Build orchestrator tool set when per-conversation agents are active.
  // This restricts the thought loop to only the orchestrator's tools
  // (consult_boss, update_tasks, ask_user, request_task_approval, consult_<slug>_agent)
  // and prevents direct file access — all file work is delegated to sub-agents.
  let customToolDefs: any[] | undefined
  let customExecuteTool: any | undefined
  let agentPromptInfo: AgentPromptInfo[] | undefined

  if (agentDefs && agentDefs.length > 0 && isInitializedForConversation(conversationId)) {
    const subAgents = getConversationAgents(conversationId)
    if (subAgents.length > 0) {
      const orchestratorTools = buildOrchestratorTools(subAgents)
      customToolDefs = orchestratorTools.definitions
      customExecuteTool = orchestratorTools.executeTool
      agentPromptInfo = agentDefs.map(d => ({
        slug: d.slug,
        name: d.name,
        description: d.description,
        whenToUse: d.whenToUse
      }))
    }
  }

  // Get or create conversation log
  let log = activeConversationLogs.get(conversationId)
  if (!log) {
    // Try to load from disk
    log = await loadLog(workspaceId, conversationId)

    if (!log) {
      // Create new log
      log = createLog(workspaceId, planningMode ? 'planning' : 'execution')
      log.id = conversationId
    }

    activeConversationLogs.set(conversationId, log)
  }

  // Update mode if changed
  log.mode = planningMode ? 'planning' : 'execution'

  // Add user message to log (skip if empty - continuation from blocking tool)
  if (content.trim()) {
    addUserMessage(log, content)
  }

  // Get abort controller for this request
  const abortController = conversationManager.startProcessing(conversationId)
  if (!abortController) {
    transport.sendError('Failed to start processing')
    return
  }

  try {
    // Event handler for events that are ONLY sent via onEvent (not transport)
    // Note: tool_started, tool_complete, blocking are sent via transport directly
    // by loopController, so we DON'T forward them here to avoid duplication
    const handleEvent = (event: ThoughtLoopEvent) => {
      switch (event.type) {
        case 'llm_streaming':
          // Streaming chunks are only sent via onEvent
          transport.sendChunk(event.chunk)
          break

        case 'iteration_started':
          // Iteration started is only sent via onEvent
          transport.sendIterationStarted(event.iterationIndex)
          break

        case 'error':
          transport.sendError(event.message)
          break

        // These are already sent via transport in loopController - don't duplicate:
        // - tool_started
        // - tool_complete
        // - loop_blocked (blocking)
      }
    }

    // Create a WebSocket-compatible transport adapter
    const transportAdapter = {
      sendChunk: (_convId: string, chunk: string) => transport.sendChunk(chunk),
      sendToolStarted: (_convId: string, toolCall: any) => transport.sendToolStarted(toolCall),
      sendToolComplete: (_convId: string, toolCallId: string, result: any) => transport.sendToolComplete(toolCallId, result),
      sendBlocking: (_convId: string, toolCallId: string, uiData: any) => transport.sendBlocking(toolCallId, uiData),
      sendTasksUpdated: (_convId: string, tasks: any[]) => transport.sendTasksUpdated(tasks),
      sendComplete: (_convId: string, waitingForInput: boolean) => transport.sendComplete(waitingForInput),
      sendError: (_convId: string, message: string) => transport.sendError(message),
      sendIterationStarted: (_convId: string, index: number) => transport.sendIterationStarted(index),
      sendOpenFile: (_path: string) => { /* Not supported in server mode */ },
      waitForToolResponse: (_convId: string, toolCallId: string) => transport.waitForToolResponse(toolCallId),
      waitForToolApproval: (_convId: string, toolCallId: string) => transport.waitForToolApproval(toolCallId)
    }

    // In server mode, force yoloMode ON because the web client doesn't have a
    // tool approval UI yet. Without this, write tools (create_file, edit_file,
    // create_directory) would hang for 5 minutes waiting for approval that never
    // comes. Tools are still sandboxed to workspace folders for safety.
    // TODO: Remove this override when the web client gets a tool approval UI.
    const effectiveYoloMode = true

    // Run thought loop — pass custom orchestrator tools when agents are active
    const result = await runThoughtLoop({
      log,
      settings: settings as any, // Cast to avoid type mismatch
      workspaceFolders,
      workspaceId,
      transport: transportAdapter as any,
      getOpenFiles: () => [], // No open files in server mode
      onEvent: handleEvent,
      yoloMode: effectiveYoloMode,
      abortSignal: abortController.signal,
      toolDefinitions: customToolDefs,
      executeToolFn: customExecuteTool,
      agentDefinitions: agentPromptInfo
    })

    // For blocking tools: mark as not processing FIRST, so the client
    // can immediately send tool_response without hitting "already processing"
    if (result.waitingForInput) {
      conversationManager.finishProcessing(conversationId)
    }

    // Save log
    await saveLog(log)

    // Send task list update
    const taskList = await loadTaskList(workspaceId, conversationId)
    if (taskList) {
      transport.sendTasksUpdated(taskList.tasks)
    }

    // Notify completion
    transport.sendComplete(result.waitingForInput)

  } catch (error) {
    console.error('[WebSocket] Error processing message:', error)

    // Save the log to preserve progress even on unexpected errors,
    // so the user can resume by sending another message
    try {
      await saveLog(log)
    } catch (saveError) {
      console.error('[WebSocket] Failed to save log after error:', saveError)
    }

    transport.sendError(error instanceof Error ? error.message : 'Unknown error')
  } finally {
    // Only call finishProcessing if we didn't already call it above
    // (for non-blocking completions, or if an error occurred before we could)
    if (conversationManager.isProcessing(conversationId)) {
      conversationManager.finishProcessing(conversationId)
    }
  }
}

/**
 * Gets all active transports for a conversation.
 */
export function getTransportsForConversation(conversationId: string): WebSocketTransport[] {
  const connections = connectionsByConversation.get(conversationId)
  return connections ? Array.from(connections) : []
}
