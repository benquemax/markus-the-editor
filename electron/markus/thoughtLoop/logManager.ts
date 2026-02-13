/**
 * Log Manager
 *
 * Handles persistence of ConversationLog data.
 * Stores logs as JSON files alongside conversations for debugging
 * and enables algorithmic context replay.
 *
 * Storage path: ~/.config/markus-the-editor/workspaces/{workspaceId}/logs/{conversationId}.json
 */

import path from 'path'
import fs from 'fs/promises'
import { existsSync } from 'fs'
import { v4 as uuidv4 } from 'uuid'
import { getConfigDir } from '../settings'
import type {
  ConversationLog,
  UserMessage,
  ThoughtIteration,
  TaskState,
  ToolCallLog
} from './types'

// ============================================================================
// Directory Management
// ============================================================================

/**
 * Gets the logs directory for a specific workspace.
 */
function getLogsDir(workspaceId: string): string {
  return path.join(getConfigDir(), 'workspaces', workspaceId, 'logs')
}

/**
 * Ensures the logs directory exists.
 */
async function ensureLogsDir(workspaceId: string): Promise<string> {
  const dir = getLogsDir(workspaceId)
  await fs.mkdir(dir, { recursive: true })
  return dir
}

/**
 * Gets the file path for a conversation's log.
 */
function getLogPath(workspaceId: string, conversationId: string): string {
  return path.join(getLogsDir(workspaceId), `${conversationId}.json`)
}

// ============================================================================
// Log CRUD Operations
// ============================================================================

/**
 * Creates a new conversation log.
 */
export function createLog(
  workspaceId: string,
  mode: 'planning' | 'execution' = 'planning'
): ConversationLog {
  const now = Date.now()
  return {
    id: uuidv4(),
    workspaceId,
    title: 'New Conversation',
    mode,
    userMessages: [],
    iterations: [],
    tasks: {
      tasks: [],
      updatedAt: now
    },
    metadata: {
      totalIterations: 0,
      condensationCount: 0
    },
    createdAt: now,
    updatedAt: now
  }
}

/**
 * Saves a conversation log to disk.
 */
export async function saveLog(log: ConversationLog): Promise<void> {
  await ensureLogsDir(log.workspaceId)
  const filePath = getLogPath(log.workspaceId, log.id)

  // Update timestamps
  log.updatedAt = Date.now()
  log.metadata.totalIterations = log.iterations.length

  // Generate title from first user message if still default
  if (log.title === 'New Conversation' && log.userMessages.length > 0) {
    const firstMessage = log.userMessages[0].content
    log.title = firstMessage.length <= 50
      ? firstMessage
      : firstMessage.substring(0, 47) + '...'
  }

  await fs.writeFile(filePath, JSON.stringify(log, null, 2), 'utf-8')
}

/**
 * Loads a conversation log by ID.
 * Returns null if no log exists.
 */
export async function loadLog(
  workspaceId: string,
  conversationId: string
): Promise<ConversationLog | null> {
  const filePath = getLogPath(workspaceId, conversationId)

  if (!existsSync(filePath)) {
    return null
  }

  try {
    const content = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(content) as ConversationLog
  } catch (error) {
    console.error('[LogManager] Failed to load log:', error)
    return null
  }
}

/**
 * Deletes a conversation log.
 */
export async function deleteLog(
  workspaceId: string,
  conversationId: string
): Promise<boolean> {
  const filePath = getLogPath(workspaceId, conversationId)

  if (!existsSync(filePath)) {
    return false
  }

  try {
    await fs.unlink(filePath)
    return true
  } catch (error) {
    console.error('[LogManager] Failed to delete log:', error)
    return false
  }
}

/**
 * Lists all conversation logs for a workspace.
 */
export async function listLogs(
  workspaceId: string
): Promise<Array<{ id: string; title: string; updatedAt: number; iterationCount: number }>> {
  const dir = getLogsDir(workspaceId)

  if (!existsSync(dir)) {
    return []
  }

  try {
    const files = await fs.readdir(dir)
    const logs: Array<{ id: string; title: string; updatedAt: number; iterationCount: number }> = []

    for (const file of files) {
      if (!file.endsWith('.json')) continue

      try {
        const content = await fs.readFile(path.join(dir, file), 'utf-8')
        const log = JSON.parse(content) as ConversationLog

        logs.push({
          id: log.id,
          title: log.title,
          updatedAt: log.updatedAt,
          iterationCount: log.iterations.length
        })
      } catch {
        // Skip invalid files
      }
    }

    return logs.sort((a, b) => b.updatedAt - a.updatedAt)
  } catch (error) {
    console.error('[LogManager] Failed to list logs:', error)
    return []
  }
}

// ============================================================================
// Log Mutation Helpers
// ============================================================================

/**
 * Adds a user message to the log.
 */
export function addUserMessage(
  log: ConversationLog,
  content: string,
  inResponseTo?: { question: string; options?: string[] }
): UserMessage {
  const message: UserMessage = {
    id: uuidv4(),
    content,
    timestamp: Date.now(),
    inResponseTo
  }

  log.userMessages.push(message)
  log.updatedAt = Date.now()

  return message
}

/**
 * Adds a thought iteration to the log.
 */
export function addIteration(
  log: ConversationLog,
  iteration: Omit<ThoughtIteration, 'id' | 'index'>
): ThoughtIteration {
  const fullIteration: ThoughtIteration = {
    ...iteration,
    id: uuidv4(),
    index: log.iterations.length
  }

  log.iterations.push(fullIteration)
  log.metadata.totalIterations = log.iterations.length
  log.updatedAt = Date.now()

  return fullIteration
}

/**
 * Updates the task state in the log.
 */
export function updateTasks(log: ConversationLog, tasks: TaskState): void {
  log.tasks = tasks
  log.updatedAt = Date.now()
}

/**
 * Sets an error in the log metadata.
 */
export function setError(log: ConversationLog, error: string): void {
  log.metadata.lastError = error
  log.updatedAt = Date.now()
}

/**
 * Updates the mode of the conversation.
 */
export function setMode(log: ConversationLog, mode: 'planning' | 'execution'): void {
  log.mode = mode
  log.updatedAt = Date.now()
}

// ============================================================================
// Query Helpers
// ============================================================================

/**
 * Gets all consult_boss messages from all iterations.
 * These are important for context as they represent what the agent
 * communicated to the user.
 */
export function getConsultBossMessages(log: ConversationLog): Array<{
  message: string
  type: string
  iterationIndex: number
  timestamp: number
}> {
  const messages: Array<{
    message: string
    type: string
    iterationIndex: number
    timestamp: number
  }> = []

  for (const iteration of log.iterations) {
    for (const toolCall of iteration.toolCalls) {
      if (toolCall.name === 'consult_boss' && toolCall.status === 'complete') {
        const args = toolCall.arguments as { message?: string; type?: string }
        if (args.message) {
          messages.push({
            message: args.message,
            type: args.type || 'info',
            iterationIndex: iteration.index,
            timestamp: toolCall.completedAt || toolCall.startedAt
          })
        }
      }
    }
  }

  return messages
}

/**
 * Gets all file read results, returning the most recent version of each file.
 * Returns a map of file path → content.
 */
export function getFileReadCache(log: ConversationLog): Map<string, {
  content: string
  readAtIteration: number
}> {
  const cache = new Map<string, { content: string; readAtIteration: number }>()

  for (const iteration of log.iterations) {
    for (const toolCall of iteration.toolCalls) {
      if (toolCall.name === 'read_file' && toolCall.cachedContent) {
        const args = toolCall.arguments as { path?: string }
        if (args.path) {
          cache.set(args.path, {
            content: toolCall.cachedContent,
            readAtIteration: iteration.index
          })
        }
      }
    }
  }

  return cache
}

/**
 * Gets the last N iterations for context building.
 */
export function getRecentIterations(
  log: ConversationLog,
  count: number = 5
): ThoughtIteration[] {
  return log.iterations.slice(-count)
}

/**
 * Formats a tool call with its key argument for context summaries.
 * Includes enough detail so the LLM knows WHAT was done, not just which tool.
 * E.g. "read_file(path:AppDelegate.swift)" instead of just "read_file".
 */
function summarizeToolCall(tc: ToolCallLog): string {
  const args = tc.arguments || {}
  // Pick the most informative argument for each tool
  const keyArg = args.path || args.query || args.message?.toString().substring(0, 50) || args.description
  const argStr = keyArg ? `(${String(keyArg).substring(0, 80)})` : ''
  const status = tc.status === 'error'
    ? `FAILED: ${tc.result?.error || 'unknown'}`
    : ''
  return status ? `${tc.name}${argStr} [${status}]` : `${tc.name}${argStr}`
}

/**
 * Gets a summary of an iteration for context condensation.
 * Includes tool names WITH key arguments so the LLM can see what was already done.
 */
export function summarizeIteration(iteration: ThoughtIteration): string {
  const toolSummaries = iteration.toolCalls.map(summarizeToolCall)

  const endType = iteration.endState.type
  const endInfo = endType === 'blocking_tool'
    ? ` (blocked by ${(iteration.endState as { type: 'blocking_tool'; toolName: string }).toolName})`
    : endType === 'error'
      ? ` (error: ${(iteration.endState as { type: 'error'; message: string }).message})`
      : ''

  return `Iteration ${iteration.index}: ${toolSummaries.join(', ') || 'no tools'}${endInfo}`
}

/**
 * Counts approximate tokens in the log.
 * Uses rough estimate of 4 chars per token.
 */
export function estimateTokens(log: ConversationLog): number {
  let chars = 0

  for (const msg of log.userMessages) {
    chars += msg.content.length
  }

  for (const iteration of log.iterations) {
    chars += iteration.response.rawContent.length
    for (const tc of iteration.toolCalls) {
      if (tc.cachedContent) {
        chars += tc.cachedContent.length
      }
    }
  }

  return Math.ceil(chars / 4)
}

/**
 * Finds the last blocking tool call if the conversation is blocked.
 */
export function getBlockingToolCall(log: ConversationLog): ToolCallLog | null {
  if (log.iterations.length === 0) return null

  const lastIteration = log.iterations[log.iterations.length - 1]
  if (lastIteration.endState.type !== 'blocking_tool') return null

  const blockingId = (lastIteration.endState as { type: 'blocking_tool'; toolCallId: string }).toolCallId
  return lastIteration.toolCalls.find(tc => tc.id === blockingId) || null
}
