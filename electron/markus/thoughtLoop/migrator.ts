/**
 * Conversation Migrator
 *
 * Handles migration from the old Conversation format (with messages array)
 * to the new ConversationLog format (with iterations array).
 *
 * Migration strategy:
 * - Detect old format by checking for messages array without iterations
 * - Convert user messages to userMessages array
 * - Convert assistant messages with tool calls to iterations
 * - Preserve all data for debugging
 */

import { v4 as uuidv4 } from 'uuid'
import type { Conversation, ChatMessage, ToolCallRecord } from '../types'
import type {
  ConversationLog,
  UserMessage,
  ThoughtIteration,
  ToolCallLog,
  LLMResponseData,
  IterationEndState,
  ParsedToolCallData
} from './types'

// ============================================================================
// Format Detection
// ============================================================================

/**
 * Detects if a conversation is in the old format.
 * Old format has 'messages' array, new format has 'iterations' array.
 */
export function isOldFormat(data: unknown): data is Conversation {
  if (!data || typeof data !== 'object') return false

  const obj = data as Record<string, unknown>

  // Old format: has 'messages' array and no 'iterations'
  return Array.isArray(obj.messages) && !Array.isArray(obj.iterations)
}

/**
 * Detects if a conversation is in the new format.
 */
export function isNewFormat(data: unknown): data is ConversationLog {
  if (!data || typeof data !== 'object') return false

  const obj = data as Record<string, unknown>

  // New format: has 'iterations' array and 'userMessages' array
  return Array.isArray(obj.iterations) && Array.isArray(obj.userMessages)
}

// ============================================================================
// Migration Functions
// ============================================================================

/**
 * Migrates an old Conversation to the new ConversationLog format.
 */
export function migrateConversation(old: Conversation): ConversationLog {
  const now = Date.now()

  // Extract user messages
  const userMessages: UserMessage[] = []
  const iterations: ThoughtIteration[] = []

  // Track which messages are tool results (internal, shouldn't be shown)
  const toolResultMessages = new Set<string>()
  const systemReminderMessages = new Set<string>()

  // First pass: identify special messages
  for (const msg of old.messages) {
    if (msg.role === 'user') {
      if (msg.content.startsWith('[Tool Results]')) {
        toolResultMessages.add(msg.id)
      } else if (msg.content.startsWith('[System]')) {
        systemReminderMessages.add(msg.id)
      }
    }
  }

  // Second pass: extract user messages and build iterations
  let currentIterationMessages: ChatMessage[] = []
  let iterationIndex = 0

  for (const msg of old.messages) {
    if (msg.role === 'user') {
      // Skip internal messages
      if (toolResultMessages.has(msg.id) || systemReminderMessages.has(msg.id)) {
        continue
      }

      // Check if this is a response to ask_user
      const isResponse = msg.content.startsWith('[User Response]')

      userMessages.push({
        id: msg.id,
        content: isResponse ? msg.content.replace('[User Response] ', '') : msg.content,
        timestamp: msg.timestamp,
        inResponseTo: isResponse ? { question: 'Previous ask_user question' } : undefined
      })
    } else if (msg.role === 'assistant') {
      currentIterationMessages.push(msg)

      // If this message is complete or has tool calls, it represents an iteration
      if (msg.status === 'complete' || (msg.toolCalls && msg.toolCalls.length > 0)) {
        const iteration = convertToIteration(msg, iterationIndex)
        if (iteration) {
          iterations.push(iteration)
          iterationIndex++
        }
        currentIterationMessages = []
      }
    }
  }

  // Determine mode from last assistant message
  const lastAssistant = old.messages.filter(m => m.role === 'assistant').pop()
  const mode = lastAssistant?.isPlan ? 'planning' : 'execution'

  return {
    id: old.id,
    filebarId: old.filebarId,
    title: old.title,
    mode,
    userMessages,
    iterations,
    tasks: {
      tasks: [],
      updatedAt: now
    },
    metadata: {
      totalIterations: iterations.length,
      condensationCount: 0
    },
    createdAt: old.createdAt,
    updatedAt: old.updatedAt
  }
}

/**
 * Converts an assistant ChatMessage to a ThoughtIteration.
 */
function convertToIteration(msg: ChatMessage, index: number): ThoughtIteration | null {
  // Skip empty messages
  if (!msg.content.trim() && (!msg.toolCalls || msg.toolCalls.length === 0)) {
    return null
  }

  // Convert tool calls
  const toolCalls: ToolCallLog[] = (msg.toolCalls || []).map(tc => convertToolCall(tc))

  // Determine end state
  let endState: IterationEndState = { type: 'continue' }

  const blockingTool = toolCalls.find(tc =>
    tc.name === 'ask_user' || tc.name === 'request_task_approval'
  )

  if (blockingTool) {
    endState = {
      type: 'blocking_tool',
      toolName: blockingTool.name,
      toolCallId: blockingTool.id
    }
  } else if (msg.status === 'error') {
    endState = { type: 'error', message: msg.error || 'Unknown error' }
  }

  // Build parsed tool calls for response data
  const parsedToolCalls: ParsedToolCallData[] = toolCalls.map(tc => ({
    id: tc.id,
    name: tc.name,
    arguments: tc.arguments
  }))

  // Build response data
  const responseData: LLMResponseData = {
    rawContent: msg.content,
    strippedContent: msg.content,
    parsedToolCalls,
    hasToolCalls: toolCalls.length > 0,
    model: undefined
  }

  return {
    id: uuidv4(),
    index,
    mode: msg.isPlan ? 'planning' : 'execution',
    request: {
      systemPrompt: '[Migrated - original system prompt not available]',
      messages: [],
      contextSources: [],
      estimatedTokens: 0
    },
    response: responseData,
    toolCalls,
    timing: {
      startedAt: msg.timestamp,
      endedAt: msg.timestamp + 1000 // Approximate
    },
    endState
  }
}

/**
 * Converts a ToolCallRecord to a ToolCallLog.
 */
function convertToolCall(tc: ToolCallRecord): ToolCallLog {
  return {
    id: tc.id,
    name: tc.name,
    arguments: tc.arguments,
    status: tc.status === 'approved' ? 'complete' : tc.status,
    startedAt: tc.startedAt,
    completedAt: tc.completedAt,
    result: tc.result !== undefined ? {
      success: tc.status === 'complete',
      data: tc.result,
      error: tc.error
    } : undefined,
    blocking: tc.name === 'ask_user' || tc.name === 'request_task_approval',
    // Cache file content if available
    cachedContent: tc.name === 'read_file' && typeof tc.result === 'string'
      ? tc.result
      : undefined
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Migrates a conversation if needed, returns as-is if already new format.
 */
export function ensureNewFormat(data: unknown): ConversationLog | null {
  if (isNewFormat(data)) {
    return data
  }

  if (isOldFormat(data)) {
    return migrateConversation(data)
  }

  return null
}

/**
 * Converts a ConversationLog back to old Conversation format.
 * Useful for backward compatibility with existing UI components.
 */
export function convertToOldFormat(log: ConversationLog): Conversation {
  const messages: ChatMessage[] = []

  // Add user messages
  for (const userMsg of log.userMessages) {
    messages.push({
      id: userMsg.id,
      role: 'user',
      content: userMsg.inResponseTo
        ? `[User Response] ${userMsg.content}`
        : userMsg.content,
      timestamp: userMsg.timestamp,
      status: 'complete'
    })
  }

  // Add iterations as assistant messages
  for (const iteration of log.iterations) {
    // Add tool results message before if there are tools
    if (iteration.toolCalls.length > 0) {
      const toolResultsContent = iteration.toolCalls
        .filter(tc => tc.status === 'complete' && tc.result)
        .map(tc => {
          const resultStr = typeof tc.result?.data === 'string'
            ? tc.result.data
            : JSON.stringify(tc.result?.data)
          return `Tool "${tc.name}":\n${resultStr}`
        })
        .join('\n\n---\n\n')

      if (toolResultsContent) {
        messages.push({
          id: uuidv4(),
          role: 'user',
          content: `[Tool Results]\n\n${toolResultsContent}`,
          timestamp: iteration.timing.startedAt,
          status: 'complete'
        })
      }
    }

    // Add assistant message
    const toolCalls: ToolCallRecord[] = iteration.toolCalls.map(tc => ({
      id: tc.id,
      name: tc.name,
      arguments: tc.arguments,
      status: tc.status === 'complete' ? 'complete' : tc.status,
      result: tc.result?.data,
      error: tc.result?.error,
      startedAt: tc.startedAt,
      completedAt: tc.completedAt
    }))

    messages.push({
      id: iteration.id,
      role: 'assistant',
      content: iteration.response.strippedContent,
      timestamp: iteration.timing.startedAt,
      toolCalls,
      isPlan: iteration.mode === 'planning',
      status: 'complete'
    })
  }

  // Sort by timestamp
  messages.sort((a, b) => a.timestamp - b.timestamp)

  return {
    id: log.id,
    title: log.title,
    filebarId: log.filebarId,
    messages,
    createdAt: log.createdAt,
    updatedAt: log.updatedAt
  }
}

/**
 * Gets display messages from a ConversationLog.
 * Filters out internal messages and returns only user-visible content.
 */
export function getDisplayMessages(log: ConversationLog): ChatMessage[] {
  const messages: ChatMessage[] = []

  // Interleave user messages and iterations chronologically
  let userMsgIndex = 0
  let iterIndex = 0

  while (userMsgIndex < log.userMessages.length || iterIndex < log.iterations.length) {
    const nextUser = log.userMessages[userMsgIndex]
    const nextIter = log.iterations[iterIndex]

    const userTime = nextUser?.timestamp ?? Infinity
    const iterTime = nextIter?.timing.startedAt ?? Infinity

    if (userTime <= iterTime && nextUser) {
      messages.push({
        id: nextUser.id,
        role: 'user',
        content: nextUser.content,
        timestamp: nextUser.timestamp,
        status: 'complete'
      })
      userMsgIndex++
    } else if (nextIter) {
      // Only include iterations that have visible content
      const consultBossCalls = nextIter.toolCalls.filter(
        tc => tc.name === 'consult_boss' && tc.status === 'complete'
      )

      for (const tc of consultBossCalls) {
        const args = tc.arguments as { message?: string; type?: string }
        if (args.message) {
          messages.push({
            id: tc.id,
            role: 'assistant',
            content: args.message,
            timestamp: tc.completedAt || tc.startedAt,
            status: 'complete'
          })
        }
      }

      iterIndex++
    }
  }

  return messages
}
