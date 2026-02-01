/**
 * Markus IPC Handlers
 *
 * Sets up all IPC handlers for the Markus AI agent feature.
 * This is the main integration point between the renderer process
 * and the backend Markus modules.
 */

import { IpcMain, BrowserWindow } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import {
  MarkusSettings,
  Conversation,
  ChatMessage,
  ToolCallRecord,
  ToolContext,
  LLMMessage,
  MemoryUpdateProposal
} from './types'
import {
  readSettings,
  writeSettings,
  ensureSettingsFile,
  getSettingsPath,
  validateSettings
} from './settings'
import { createLLMClient, generateToolSchema } from './llm'
import { TOOL_DEFINITIONS, executeTool } from './tools'
import {
  createConversation,
  saveConversation,
  loadConversation,
  loadLatestConversation,
  listConversations,
  deleteConversation,
  getFilebarId
} from './conversations'
import { getAllContext, proposeMemoryUpdate, applyMemoryUpdate } from './memory'

/** Active abort controllers for cancellation */
const activeRequests = new Map<string, AbortController>()

/** Pending tool approvals */
const pendingToolApprovals = new Map<string, {
  resolve: (approved: boolean) => void
  toolCall: ToolCallRecord
}>()

/** Pending memory update proposals */
const pendingMemoryProposals = new Map<string, MemoryUpdateProposal>()

/**
 * Builds the system prompt for Markus.
 */
async function buildSystemPrompt(workspaceFolders: string[]): Promise<string> {
  const context = await getAllContext(workspaceFolders)
  const toolSchema = generateToolSchema(TOOL_DEFINITIONS)

  let systemPrompt = `You are Markus, an AI assistant integrated into a markdown editor.

CRITICAL BEHAVIOR RULES (MUST FOLLOW):
1. NEVER introduce yourself. NEVER explain what you can do. NEVER greet the user. Just DO the task.
2. When the user asks you to do something, START DOING IT IMMEDIATELY using tools.
3. Your FIRST response to any task request MUST include tool calls - no exceptions.
4. Do NOT say "I'll help you with..." or "Let me..." - just USE THE TOOLS.
5. After receiving tool results, CONTINUE working - call more tools or provide your analysis.
6. Keep text responses SHORT. Focus on actions and results, not explanations.
7. If you find yourself repeating a previous response, STOP and try a different approach.

WRONG (never do this):
- "What would you like me to help you with?"
- "I'd be happy to help! Let me..."
- "Hello! I'm Markus..."

RIGHT (always do this):
- [immediately use get_workspace_folders tool]
- [immediately use list_directory tool]
- [provide analysis based on tool results]

${toolSchema}

`

  if (context.systemInstructions) {
    systemPrompt += `## Global Instructions\n\n${context.systemInstructions}\n\n`
  }

  if (context.projectInstructions) {
    systemPrompt += `## Project Instructions\n\n${context.projectInstructions}\n\n`
  }

  if (context.systemMemory) {
    systemPrompt += `## Memory (Global)\n\n${context.systemMemory}\n\n`
  }

  if (context.projectMemory) {
    systemPrompt += `## Memory (Project)\n\n${context.projectMemory}\n\n`
  }

  return systemPrompt
}

/**
 * Converts conversation messages to LLM format.
 * Filters out empty assistant messages which can occur from failed requests.
 */
function conversationToLLMMessages(
  conversation: Conversation,
  systemPrompt: string
): LLMMessage[] {
  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt }
  ]

  for (const msg of conversation.messages) {
    if (msg.role === 'user' || msg.role === 'assistant') {
      // Skip empty assistant messages (can happen from failed/aborted requests)
      if (msg.role === 'assistant' && !msg.content.trim()) {
        continue
      }
      messages.push({
        role: msg.role,
        content: msg.content
      })
    }
  }

  return messages
}

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
    const mainWindow = getMainWindow()

    if (!mainWindow) {
      return { success: false, error: 'No window available' }
    }

    const settings = await readSettings()
    const validation = validateSettings(settings)

    if (!validation.valid) {
      return { success: false, error: validation.errors.join(', ') }
    }

    // Add user message
    const userMessage: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content: message,
      timestamp: Date.now(),
      status: 'complete'
    }
    conversation.messages.push(userMessage)

    // Create assistant message placeholder
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
      const workspaceFolders = getWorkspaceFolders()
      const systemPrompt = await buildSystemPrompt(workspaceFolders)
      const client = createLLMClient(settings.llm)

      // Agentic loop - continue until no more tool calls
      const MAX_ITERATIONS = 10
      let iteration = 0
      let currentAssistantMessage = assistantMessage
      const previousResponses: string[] = [] // Track previous responses for deduplication

      while (iteration < MAX_ITERATIONS) {
        iteration++
        console.log(`[Markus] Agentic loop iteration ${iteration}`)

        const llmMessages = conversationToLLMMessages(conversation, systemPrompt)
        // Remove the current streaming assistant message from LLM messages
        llmMessages.pop()

        // Stream response
        let fullContent = ''
        console.log('[Markus] Starting stream...')
        for await (const chunk of client.chatStream(
          llmMessages,
          TOOL_DEFINITIONS,
          abortController.signal
        )) {
          if (chunk.type === 'content' && chunk.content) {
            fullContent += chunk.content
            mainWindow.webContents.send('markus:messageChunk', {
              conversationId: conversation.id,
              chunk: chunk.content
            })
          }
        }
        console.log('[Markus] Stream complete. Full content length:', fullContent.length)
        console.log('[Markus] Full content preview:', fullContent.slice(0, 200))

        // Parse for tool calls (MD_JSON format)
        const { textContent, toolCalls } = parseContentForToolCalls(fullContent)
        // Strip any reasoning/thinking content that leaked into the response
        const strippedContent = stripReasoningContent(textContent)
        currentAssistantMessage.content = strippedContent

        // Check for repetition - if the LLM is repeating itself, break the loop
        const normalizedResponse = strippedContent.toLowerCase().trim().substring(0, 200)
        if (normalizedResponse && previousResponses.some(prev =>
          prev.toLowerCase().trim().substring(0, 200) === normalizedResponse
        )) {
          console.log('[Markus] Detected repetition, breaking agentic loop')
          currentAssistantMessage.content += '\n\n*[I seem to be repeating myself. Please provide more specific instructions.]*'
          break
        }
        previousResponses.push(strippedContent)

        // If no tool calls, we're done
        if (toolCalls.length === 0) {
          console.log('[Markus] No tool calls, ending agentic loop')
          break
        }

        // Execute tool calls
        const toolResults: Array<{ name: string; result: string; success: boolean }> = []

        for (const toolCall of toolCalls) {
          const toolCallRecord: ToolCallRecord = {
            id: toolCall.id,
            name: toolCall.name,
            arguments: toolCall.arguments,
            status: 'pending',
            startedAt: Date.now()
          }

          currentAssistantMessage.toolCalls = currentAssistantMessage.toolCalls || []
          currentAssistantMessage.toolCalls.push(toolCallRecord)

          mainWindow.webContents.send('markus:toolCallStarted', {
            conversationId: conversation.id,
            toolCall: toolCallRecord
          })

          // Check if approval needed
          let shouldExecute = yoloMode

          if (!shouldExecute) {
            const isSafe = isSafeTool(toolCall.name)

            if (planningMode) {
              // Planning mode: require approval for ALL tools
              shouldExecute = await waitForToolApproval(conversation.id, toolCallRecord)
            } else if (isSafe) {
              // Execution mode with safe tool: auto-execute
              shouldExecute = true
            } else {
              // Execution mode with dangerous tool: require approval
              shouldExecute = await waitForToolApproval(conversation.id, toolCallRecord)
            }
          }

          if (shouldExecute) {
            toolCallRecord.status = 'executing'

            const context: ToolContext = {
              workspaceFolders,
              openFiles: getOpenFiles(),
              mainWindow
            }

            const result = await executeTool(toolCall.name, toolCall.arguments, context)

            toolCallRecord.status = result.success ? 'complete' : 'error'
            toolCallRecord.result = result.result
            toolCallRecord.error = result.error
            toolCallRecord.completedAt = Date.now()

            mainWindow.webContents.send('markus:toolCallComplete', {
              conversationId: conversation.id,
              toolCallId: toolCall.id,
              result
            })

            // Auto-open created/edited files
            if (result.openFile) {
              mainWindow.webContents.send('file:openPath', result.openFile)
            }

            // Collect result for continuation
            toolResults.push({
              name: toolCall.name,
              result: result.success
                ? (typeof result.result === 'string' ? result.result : JSON.stringify(result.result))
                : `Error: ${result.error}`,
              success: result.success
            })
          } else {
            toolCallRecord.status = 'rejected'
            toolCallRecord.completedAt = Date.now()
            toolResults.push({
              name: toolCall.name,
              result: 'Tool call was rejected by user',
              success: false
            })
          }
        }

        // If all tools were rejected, stop the loop
        if (toolResults.every(r => !r.success && r.result === 'Tool call was rejected by user')) {
          console.log('[Markus] All tools rejected, ending agentic loop')
          break
        }

        // Mark current assistant message as complete
        currentAssistantMessage.status = 'complete'

        // Add tool results as a user message for context
        const toolResultsContent = toolResults.map(r =>
          `Tool "${r.name}" result:\n${r.result}`
        ).join('\n\n')

        const toolResultMessage: ChatMessage = {
          id: uuidv4(),
          role: 'user',
          content: `[Tool Results]\n\n${toolResultsContent}\n\nPlease continue based on these results.`,
          timestamp: Date.now(),
          status: 'complete'
        }
        conversation.messages.push(toolResultMessage)

        // Create new assistant message for the continuation
        currentAssistantMessage = {
          id: uuidv4(),
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          status: 'streaming',
          isPlan: planningMode,
          toolCalls: []
        }
        conversation.messages.push(currentAssistantMessage)

        // Notify frontend of the continuation
        mainWindow.webContents.send('markus:messageChunk', {
          conversationId: conversation.id,
          chunk: '' // Signal new message started
        })
      }

      currentAssistantMessage.status = 'complete'
      await saveConversation(conversation)

      mainWindow.webContents.send('markus:requestComplete', {
        conversationId: conversation.id,
        messageId: currentAssistantMessage.id
      })

      return { success: true, conversation }
    } catch (error) {
      assistantMessage.status = 'error'
      assistantMessage.error = String(error)
      await saveConversation(conversation)

      mainWindow.webContents.send('markus:requestError', {
        conversationId: conversation.id,
        error: String(error)
      })

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
    const key = `${args.conversationId}:${args.toolCallId}`
    const pending = pendingToolApprovals.get(key)

    if (pending) {
      pending.resolve(args.approved)
      pendingToolApprovals.delete(key)
      return { success: true }
    }

    return { success: false, error: 'No pending approval' }
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
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Strips reasoning/thinking content from LLM responses.
 * Some models (like Kimi's thinking models) include internal reasoning
 * directly in the content field. This function attempts to extract just
 * the user-facing response.
 *
 * Patterns detected:
 * - Text before a greeting (Hello, Hi, Hey) that contains reasoning markers
 * - Reasoning markers: "Let me", "I should", "The user is", "I don't need to", etc.
 */
function stripReasoningContent(content: string): string {
  // Common reasoning pattern indicators
  const reasoningPatterns = [
    /^The user (is|has|wants|seems)/i,
    /^Let me /i,
    /^I (should|need to|will|don't need|can|cannot)/i,
    /^Since /i,
    /^First,? I/i,
    /^Now I/i,
    /^Looking at/i,
    /^Based on/i,
    /^Analyzing/i,
  ]

  // Check if content starts with reasoning patterns
  const hasReasoningStart = reasoningPatterns.some(pattern => pattern.test(content.trim()))

  if (!hasReasoningStart) {
    return content
  }

  // Try to find where the actual response starts
  // Common patterns: greeting, markdown heading, or direct statement
  const responseStartPatterns = [
    // Greetings
    /(?:^|\n\n)(Hello[!,]?\s)/im,
    /(?:^|\n\n)(Hi[!,]?\s)/im,
    /(?:^|\n\n)(Hey[!,]?\s)/im,
    /(?:^|\n\n)(Good (?:morning|afternoon|evening)[!,]?\s)/im,
    // Markdown headings
    /(?:^|\n\n)(#{1,3}\s+\w)/m,
    // Direct statements that look like responses
    /(?:^|\n\n)(I'd be happy to)/im,
    /(?:^|\n\n)(I can help)/im,
    /(?:^|\n\n)(Sure[!,]?\s)/im,
    /(?:^|\n\n)(Absolutely[!,]?\s)/im,
    /(?:^|\n\n)(Great question)/im,
    /(?:^|\n\n)(Here's )/im,
    /(?:^|\n\n)(Here are )/im,
  ]

  for (const pattern of responseStartPatterns) {
    const match = content.match(pattern)
    if (match && match.index !== undefined) {
      // Found a response start - extract from there
      const responseStart = match.index + (match[0].startsWith('\n') ? 2 : 0)
      const extracted = content.slice(responseStart).trim()
      if (extracted.length > 50) {
        // Only use if we have substantial content
        console.log('[Markus] Stripped reasoning content, extracted response starting with:', extracted.slice(0, 50))
        return extracted
      }
    }
  }

  // If no clear response start found, return original content
  // (better to show reasoning than nothing)
  return content
}

/**
 * Parses content for MD_JSON tool calls.
 * Supports both markdown code blocks (```json...```) and plain JSON objects.
 */
function parseContentForToolCalls(content: string): {
  textContent: string
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
} {
  const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = []
  let textContent = content

  console.log('[Markus] Parsing content for tool calls, length:', content.length)
  console.log('[Markus] Content preview:', content.substring(0, 300))

  // First, try to match JSON in markdown code blocks (handles various formats)
  // Match ```json or ``` followed by json content
  const jsonBlockRegex = /```(?:json)?\s*\n?\s*(\{[\s\S]*?\})\s*\n?```/g
  let match

  while ((match = jsonBlockRegex.exec(content)) !== null) {
    try {
      const jsonContent = match[1].trim()
      console.log('[Markus] Found JSON block:', jsonContent.substring(0, 100))
      const parsed = JSON.parse(jsonContent)

      if (parsed.tool && typeof parsed.tool === 'string') {
        console.log('[Markus] Parsed tool call:', parsed.tool)
        toolCalls.push({
          id: uuidv4(),
          name: parsed.tool,
          arguments: parsed.arguments || {}
        })
        textContent = textContent.replace(match[0], '').trim()
      }
    } catch (e) {
      console.log('[Markus] JSON parse error:', e)
    }
  }

  // Also try to match plain JSON objects with "tool" field (not in code blocks)
  // More permissive regex that handles empty and non-empty arguments
  const plainJsonRegex = /\{\s*"tool"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*(\{[^{}]*\}|\{\})\s*\}/g

  while ((match = plainJsonRegex.exec(textContent)) !== null) {
    try {
      console.log('[Markus] Found plain JSON:', match[0].substring(0, 100))
      const parsed = JSON.parse(match[0])

      if (parsed.tool && typeof parsed.tool === 'string') {
        console.log('[Markus] Parsed plain tool call:', parsed.tool)
        toolCalls.push({
          id: uuidv4(),
          name: parsed.tool,
          arguments: parsed.arguments || {}
        })
        textContent = textContent.replace(match[0], '').trim()
      }
    } catch (e) {
      console.log('[Markus] Plain JSON parse error:', e)
    }
  }

  // Handle case where entire content is just a JSON tool call (no code block markers)
  if (toolCalls.length === 0 && textContent.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(textContent.trim())
      if (parsed.tool && typeof parsed.tool === 'string') {
        console.log('[Markus] Parsed bare JSON tool call:', parsed.tool)
        toolCalls.push({
          id: uuidv4(),
          name: parsed.tool,
          arguments: parsed.arguments || {}
        })
        textContent = ''
      }
    } catch {
      // Not valid JSON
    }
  }

  console.log('[Markus] Found', toolCalls.length, 'tool calls')
  return { textContent, toolCalls }
}

/**
 * Waits for user approval of a tool call.
 */
function waitForToolApproval(conversationId: string, toolCall: ToolCallRecord): Promise<boolean> {
  return new Promise(resolve => {
    const key = `${conversationId}:${toolCall.id}`
    pendingToolApprovals.set(key, { resolve, toolCall })

    // Auto-reject after 5 minutes
    setTimeout(() => {
      if (pendingToolApprovals.has(key)) {
        pendingToolApprovals.delete(key)
        resolve(false)
      }
    }, 5 * 60 * 1000)
  })
}

/**
 * Checks if a tool is safe to execute without approval.
 * Read-only tools are considered safe.
 */
function isSafeTool(toolName: string): boolean {
  const safeTools = [
    'read_file',
    'list_directory',
    'search_files',
    'get_open_files',
    'get_workspace_folders'
  ]
  return safeTools.includes(toolName)
}
