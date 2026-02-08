/**
 * Markus IPC Handlers
 *
 * Sets up all IPC handlers for the Markus AI agent feature.
 * This is the main integration point between the renderer process
 * and the backend Markus modules.
 *
 * Now uses the refactored thought loop with algorithmic context fabrication
 * for better context management and debugging capabilities.
 */

import { IpcMain, BrowserWindow } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import {
  MarkusSettings,
  Conversation,
  ChatMessage,
  MemoryUpdateProposal
} from './types'
import { createIPCTransport, IPCTransport } from './transport'
import {
  readSettings,
  writeSettings,
  ensureSettingsFile,
  getSettingsPath,
  validateSettings,
  isMultiAgentEnabled
} from './settings'
import {
  createConversation,
  saveConversation,
  loadConversation,
  loadLatestConversation,
  listConversations,
  deleteConversation,
  getFilebarId
} from './conversations'
import { proposeMemoryUpdate, applyMemoryUpdate } from './memory'
import {
  loadTaskList,
  deleteTaskList
} from './tasks'
import { createLLMClient } from './llm'

// Thought loop imports
import {
  createLog,
  saveLog,
  loadLog,
  addUserMessage,
  runThoughtLoop,
  convertToOldFormat
} from './thoughtLoop'
import type { ConversationLog, ThoughtLoopEvent } from './thoughtLoop'

// Multi-agent system imports
import {
  initializeMultiAgentSystem,
  shutdownMultiAgentSystem,
  getAgentStatuses,
  getRAGIndexStatus,
  reindexWorkspace,
  onAgentStatusChange,
  onTaskCreated,
  onTaskCompleted,
  onError,
  isInitialized as isMultiAgentInitialized
} from './multiAgent'
import { agentEventBus } from './agents'

/** Active abort controllers for cancellation */
const activeRequests = new Map<string, AbortController>()

/** Active conversation logs (in-memory cache for current sessions) */
const activeConversationLogs = new Map<string, ConversationLog>()

/** Pending memory update proposals */
const pendingMemoryProposals = new Map<string, MemoryUpdateProposal>()

/** Global transport instance - initialized per setup call */
let transport: IPCTransport | null = null

/**
 * Sets up all Markus IPC handlers.
 */
export function setupMarkusHandlers(
  ipcMain: IpcMain,
  getMainWindow: () => BrowserWindow | null,
  getWorkspaceFolders: () => string[],
  getOpenFiles: () => string[],
  openFile: (filePath: string) => Promise<void>
) {
  // Create transport for IPC communication
  transport = createIPCTransport(getMainWindow)

  // ========================================================================
  // Settings Handlers
  // ========================================================================

  ipcMain.handle('markus:getSettings', async () => {
    await ensureSettingsFile()
    return readSettings()
  })

  ipcMain.handle('markus:setSettings', async (_, settings: Partial<MarkusSettings>) => {
    const current = await readSettings()
    const updated: MarkusSettings = {
      ...current,
      ...settings,
      llm: { ...current.llm, ...settings.llm },
      search: { ...current.search, ...settings.search }
    }
    await writeSettings(updated)
    return updated
  })

  ipcMain.handle('markus:openSettings', async () => {
    await ensureSettingsFile()
    const settingsPath = getSettingsPath()
    // Open the settings file in the Markus editor
    await openFile(settingsPath)
    return { success: true, path: settingsPath }
  })

  ipcMain.handle('markus:validateSettings', async () => {
    const settings = await readSettings()
    return validateSettings(settings)
  })

  ipcMain.handle('markus:testConnection', async () => {
    const settings = await readSettings()
    const validation = validateSettings(settings)

    if (!validation.valid) {
      return { success: false, error: validation.errors.join(', ') }
    }

    const client = createLLMClient(settings.llm)
    return client.testConnection()
  })

  // ========================================================================
  // Conversation Handlers
  // ========================================================================

  ipcMain.handle('markus:createConversation', async () => {
    const folders = getWorkspaceFolders()
    const filebarId = getFilebarId(folders)
    return createConversation(filebarId)
  })

  ipcMain.handle('markus:loadConversation', async (_, conversationId: string) => {
    const folders = getWorkspaceFolders()
    const filebarId = getFilebarId(folders)
    return loadConversation(filebarId, conversationId)
  })

  ipcMain.handle('markus:loadLatestConversation', async () => {
    const folders = getWorkspaceFolders()
    const filebarId = getFilebarId(folders)
    return loadLatestConversation(filebarId)
  })

  ipcMain.handle('markus:saveConversation', async (_, conversation: Conversation) => {
    await saveConversation(conversation)
    return { success: true }
  })

  ipcMain.handle('markus:listConversations', async () => {
    const folders = getWorkspaceFolders()
    const filebarId = getFilebarId(folders)
    return listConversations(filebarId)
  })

  ipcMain.handle('markus:deleteConversation', async (_, conversationId: string) => {
    const folders = getWorkspaceFolders()
    const filebarId = getFilebarId(folders)
    return deleteConversation(filebarId, conversationId)
  })

  // ========================================================================
  // Chat Handlers
  // ========================================================================

  ipcMain.handle('markus:sendMessage', async (_, args: {
    conversation: Conversation
    message: string
    planningMode: boolean
    yoloMode: boolean
  }) => {
    const { conversation, message, planningMode, yoloMode } = args

    if (!transport) {
      return { success: false, error: 'Transport not initialized' }
    }

    const settings = await readSettings()
    const validation = validateSettings(settings)

    if (!validation.valid) {
      return { success: false, error: validation.errors.join(', ') }
    }

    const workspaceFolders = getWorkspaceFolders()
    const filebarId = getFilebarId(workspaceFolders)

    // Get or create conversation log
    let log = activeConversationLogs.get(conversation.id)
    if (!log) {
      // Try to load from disk
      log = await loadLog(filebarId, conversation.id)

      if (!log) {
        // Create new log
        log = createLog(filebarId, planningMode ? 'planning' : 'execution')
        log.id = conversation.id // Use same ID as conversation for compatibility
      }

      activeConversationLogs.set(conversation.id, log)
    }

    // Update mode if changed
    log.mode = planningMode ? 'planning' : 'execution'

    // Add user message to log (skip if empty - this is a continuation from blocking tool)
    if (message.trim()) {
      addUserMessage(log, message)

      // Also add to old conversation format for UI compatibility
      const userMessage: ChatMessage = {
        id: uuidv4(),
        role: 'user',
        content: message,
        timestamp: Date.now(),
        status: 'complete'
      }
      conversation.messages.push(userMessage)
    }

    // Create assistant message placeholder for UI
    const assistantMessage: ChatMessage = {
      id: uuidv4(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      status: 'streaming',
      isPlan: planningMode,
      toolCalls: []
    }
    conversation.messages.push(assistantMessage)

    // Create abort controller
    const abortController = new AbortController()
    activeRequests.set(conversation.id, abortController)

    try {
      // Create event handler for UI updates via transport
      // Note: The transport is already sending events, so this handler just
      // forwards streaming events for UI synchronization
      const handleEvent = (event: ThoughtLoopEvent) => {
        switch (event.type) {
          case 'llm_streaming':
            transport!.sendChunk(conversation.id, event.chunk)
            break

          case 'loop_blocked':
            // Already sent by transport in LoopController
            break

          case 'error':
            transport!.sendError(conversation.id, event.message)
            break
        }
      }

      // Run thought loop with transport
      const result = await runThoughtLoop({
        log,
        settings,
        workspaceFolders,
        filebarId,
        transport: transport!,
        getOpenFiles,
        onEvent: handleEvent,
        yoloMode,
        abortSignal: abortController.signal
      })

      // Save log
      await saveLog(log)

      // Convert log to old conversation format for UI compatibility
      const updatedConversation = convertToOldFormat(log)

      // Save old format too
      await saveConversation(updatedConversation)

      // Send task list update
      const taskList = await loadTaskList(filebarId, conversation.id)
      if (taskList) {
        transport!.sendTasksUpdated(conversation.id, taskList.tasks)
      }

      // Notify completion
      transport!.sendComplete(conversation.id, result.waitingForInput)

      return {
        success: true,
        conversation: updatedConversation,
        waitingForInput: result.waitingForInput
      }
    } catch (error) {
      assistantMessage.status = 'error'
      assistantMessage.error = String(error)
      await saveConversation(conversation)

      transport!.sendError(conversation.id, String(error))

      return { success: false, error: String(error) }
    } finally {
      activeRequests.delete(conversation.id)
    }
  })

  ipcMain.handle('markus:cancelRequest', (_, conversationId: string) => {
    const controller = activeRequests.get(conversationId)
    if (controller) {
      controller.abort()
      activeRequests.delete(conversationId)

      // Cancel any pending transport operations
      if (transport) {
        transport.cancelPending(conversationId)
      }

      return { success: true }
    }
    return { success: false, error: 'No active request' }
  })

  // ========================================================================
  // Tool Approval Handlers
  // ========================================================================

  ipcMain.handle('markus:approveTool', (_, args: {
    conversationId: string
    toolCallId: string
    approved: boolean
  }) => {
    if (!transport) {
      return { success: false, error: 'Transport not initialized' }
    }

    const resolved = transport.resolveToolApproval(
      args.conversationId,
      args.toolCallId,
      args.approved
    )

    if (resolved) {
      return { success: true }
    }

    return { success: false, error: 'No pending approval' }
  })

  // ========================================================================
  // User Response Handlers (for blocking tools)
  // ========================================================================

  /**
   * Handle user response to ask_user tool.
   * Note: The actual message is added by the frontend before calling sendMessage.
   * This handler is kept for potential future use (e.g., logging, validation).
   */
  ipcMain.handle('markus:submitUserResponse', async () => {
    // Response message is now added by the frontend directly to the conversation
    // before calling sendMessage with empty message to continue
    return { success: true }
  })

  /**
   * Handle task approval.
   * Clears the task list and allows conversation to continue.
   */
  ipcMain.handle('markus:approveTask', async (_, args: {
    conversationId: string
  }) => {
    const { conversationId } = args
    const workspaceFolders = getWorkspaceFolders()
    const filebarId = getFilebarId(workspaceFolders)

    // Delete the task list
    await deleteTaskList(filebarId, conversationId)

    // Notify frontend via transport
    if (transport) {
      transport.sendTasksUpdated(conversationId, [])
    }

    return { success: true }
  })

  /**
   * Get current task list for a conversation.
   */
  ipcMain.handle('markus:getTaskList', async (_, conversationId: string) => {
    const workspaceFolders = getWorkspaceFolders()
    const filebarId = getFilebarId(workspaceFolders)
    const taskList = await loadTaskList(filebarId, conversationId)
    return taskList ? taskList.tasks : []
  })

  // ========================================================================
  // Memory Handlers
  // ========================================================================

  ipcMain.handle('markus:proposeMemoryUpdate', async (_, args: {
    scope: 'system' | 'project'
    action: 'add' | 'update' | 'remove'
    section: string
    content: string
  }) => {
    const folders = getWorkspaceFolders()
    const proposal = await proposeMemoryUpdate(args, folders[0])
    pendingMemoryProposals.set(proposal.id, proposal)
    return proposal
  })

  ipcMain.handle('markus:applyMemoryUpdate', async (_, proposalId: string) => {
    const proposal = pendingMemoryProposals.get(proposalId)
    if (!proposal) {
      return { success: false, error: 'Proposal not found' }
    }

    const folders = getWorkspaceFolders()
    await applyMemoryUpdate(proposal, folders[0])
    pendingMemoryProposals.delete(proposalId)

    return { success: true }
  })

  ipcMain.handle('markus:rejectMemoryUpdate', (_, proposalId: string) => {
    pendingMemoryProposals.delete(proposalId)
    return { success: true }
  })

  // ========================================================================
  // Multi-Agent Status Handlers
  // ========================================================================

  ipcMain.handle('markus:getAgentStatuses', () => {
    if (!isMultiAgentInitialized()) {
      return []
    }
    return getAgentStatuses()
  })

  ipcMain.handle('markus:getRAGStatus', () => {
    if (!isMultiAgentInitialized()) {
      return {
        indexing: false,
        totalFiles: 0,
        indexedFiles: 0,
        totalChunks: 0,
        lastUpdated: null
      }
    }
    return getRAGIndexStatus()
  })

  ipcMain.handle('markus:reindexWorkspace', async () => {
    if (!isMultiAgentInitialized()) {
      return { success: false, error: 'Multi-agent system not initialized' }
    }
    try {
      await reindexWorkspace()
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // ========================================================================
  // Multi-Agent Event Subscriptions
  // ========================================================================

  // Subscribe to agent status changes and forward to renderer
  const unsubscribeAgentStatus = onAgentStatusChange((data) => {
    const mainWindow = getMainWindow()
    if (mainWindow) {
      mainWindow.webContents.send('markus:agentStatus', data)
    }
  })

  // Subscribe to task events
  const unsubscribeTaskCreated = onTaskCreated((data) => {
    const mainWindow = getMainWindow()
    if (mainWindow) {
      mainWindow.webContents.send('markus:taskCreated', data)
    }
  })

  const unsubscribeTaskCompleted = onTaskCompleted((data) => {
    const mainWindow = getMainWindow()
    if (mainWindow) {
      mainWindow.webContents.send('markus:taskCompleted', data)
    }
  })

  const unsubscribeError = onError((data) => {
    const mainWindow = getMainWindow()
    if (mainWindow) {
      mainWindow.webContents.send('markus:agentError', data)
    }
  })

  // Subscribe to thinking events from the event bus
  const unsubscribeThinking = agentEventBus.on('agent:status', (data) => {
    if (data.status === 'thinking' || data.status === 'executing') {
      const mainWindow = getMainWindow()
      if (mainWindow) {
        mainWindow.webContents.send('markus:thinking', {
          agent: data.agent,
          status: data.status,
          details: data.details
        })
      }
    }
  })

  // Initialize multi-agent system on first settings load
  const initMultiAgentIfNeeded = async () => {
    if (isMultiAgentInitialized()) return

    try {
      const settings = await readSettings()
      const folders = getWorkspaceFolders()

      if (isMultiAgentEnabled(settings) && folders.length > 0) {
        await initializeMultiAgentSystem(settings, folders)
        console.log('[Markus] Multi-agent system initialized')
      }
    } catch (error) {
      console.error('[Markus] Failed to initialize multi-agent system:', error)
    }
  }

  // Call initialization (non-blocking)
  initMultiAgentIfNeeded()

  // Return cleanup function (for proper shutdown)
  return () => {
    unsubscribeAgentStatus()
    unsubscribeTaskCreated()
    unsubscribeTaskCompleted()
    unsubscribeError()
    unsubscribeThinking()
    shutdownMultiAgentSystem()
  }
}

