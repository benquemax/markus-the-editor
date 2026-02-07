/**
 * Loop Controller
 *
 * State machine for the thought loop. Manages the iteration cycle:
 * IDLE → THINKING → EXECUTING → [BLOCKED | CONTINUE | DONE]
 *
 * Stop conditions:
 * - blocking_tool: ask_user or request_task_approval executed
 * - max_iterations: Hit 100 iterations
 * - max_no_tool_retries: 3 consecutive responses without tools
 * - repetition_detected: Same response twice
 * - user_cancelled: User cancelled request
 * - error: Unhandled error
 */

import { v4 as uuidv4 } from 'uuid'
import { BrowserWindow } from 'electron'
import { createLLMClient } from '../llm'
import { TOOL_DEFINITIONS, executeTool } from '../tools'
import { loadTaskList, createTaskList } from '../tasks'
import type {
  MarkusSettings,
  ToolContext,
  ToolCallRecord
} from '../types'
import type {
  ConversationLog,
  ThoughtIteration,
  ToolCallLog,
  ToolCallResult,
  LoopState,
  StopCondition,
  IterationEndState,
  LLMResponseData,
  ParsedToolCallData,
  ThoughtLoopEventHandler
} from './types'
import { DEFAULT_LOOP_CONFIG } from './types'
import {
  saveLog,
  addIteration,
  addUserMessage,
  updateTasks
} from './logManager'
import {
  buildContext,
  buildInitialContext,
  contextToLLMMessages,
  createRequestContext
} from './contextBuilder'
import type { BuiltContext } from './types'

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Strips reasoning/thinking content from LLM responses.
 * Some models include internal reasoning that shouldn't be shown.
 */
function stripReasoningContent(content: string): string {
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

  const hasReasoningStart = reasoningPatterns.some(pattern => pattern.test(content.trim()))

  if (!hasReasoningStart) {
    return content
  }

  const responseStartPatterns = [
    /(?:^|\n\n)(Hello[!,]?\s)/im,
    /(?:^|\n\n)(Hi[!,]?\s)/im,
    /(?:^|\n\n)(Hey[!,]?\s)/im,
    /(?:^|\n\n)(#{1,3}\s+\w)/m,
    /(?:^|\n\n)(I'd be happy to)/im,
    /(?:^|\n\n)(I can help)/im,
    /(?:^|\n\n)(Sure[!,]?\s)/im,
    /(?:^|\n\n)(Here's )/im,
    /(?:^|\n\n)(Here are )/im,
  ]

  for (const pattern of responseStartPatterns) {
    const match = content.match(pattern)
    if (match && match.index !== undefined) {
      const responseStart = match.index + (match[0].startsWith('\n') ? 2 : 0)
      const extracted = content.slice(responseStart).trim()
      if (extracted.length > 50) {
        return extracted
      }
    }
  }

  return content
}

/**
 * Parses content for MD_JSON tool calls.
 */
function parseContentForToolCalls(content: string): {
  textContent: string
  toolCalls: ParsedToolCallData[]
} {
  const toolCalls: ParsedToolCallData[] = []
  let textContent = content

  // Match JSON in markdown code blocks
  const jsonBlockRegex = /```(?:json)?\s*\n?\s*(\{[\s\S]*?\})\s*\n?```/g
  let match

  while ((match = jsonBlockRegex.exec(content)) !== null) {
    try {
      const jsonContent = match[1].trim()
      const parsed = JSON.parse(jsonContent)

      if (parsed.tool && typeof parsed.tool === 'string') {
        toolCalls.push({
          id: uuidv4(),
          name: parsed.tool,
          arguments: parsed.arguments || {}
        })
        textContent = textContent.replace(match[0], '').trim()
      }
    } catch {
      // Not valid JSON, skip
    }
  }

  // Extract JSON objects from text
  const extractJsonObjects = (text: string): Array<{ json: string; start: number; end: number }> => {
    const objects: Array<{ json: string; start: number; end: number }> = []
    let i = 0
    while (i < text.length) {
      if (text[i] === '{') {
        let depth = 1
        const start = i
        i++
        while (i < text.length && depth > 0) {
          if (text[i] === '{') depth++
          else if (text[i] === '}') depth--
          i++
        }
        if (depth === 0) {
          objects.push({ json: text.substring(start, i), start, end: i })
        }
      } else {
        i++
      }
    }
    return objects
  }

  const jsonObjects = extractJsonObjects(textContent)
  const indicesToRemove: Array<{ start: number; end: number }> = []

  for (const { json, start, end } of jsonObjects) {
    try {
      const parsed = JSON.parse(json)
      if (parsed.tool && typeof parsed.tool === 'string') {
        toolCalls.push({
          id: uuidv4(),
          name: parsed.tool,
          arguments: parsed.arguments || {}
        })
        indicesToRemove.push({ start, end })
      }
    } catch {
      // Not valid JSON, skip
    }
  }

  indicesToRemove.sort((a, b) => b.start - a.start)
  for (const { start, end } of indicesToRemove) {
    textContent = textContent.substring(0, start) + textContent.substring(end)
  }
  textContent = textContent.trim()

  return { textContent, toolCalls }
}

/**
 * Checks if a tool is safe to execute without approval.
 */
function isSafeTool(toolName: string): boolean {
  const safeTools = [
    'read_file',
    'list_directory',
    'search_files',
    'get_open_files',
    'get_workspace_folders',
    'consult_research_agent',
    'consult_critique_agent',
    'consult_style_agent',
    'consult_creative_agent'
  ]
  return safeTools.includes(toolName)
}

/**
 * Checks if a tool is a thought loop control tool (always allowed).
 */
function isThoughtLoopTool(toolName: string): boolean {
  return ['consult_boss', 'update_tasks', 'ask_user', 'request_task_approval'].includes(toolName)
}

/**
 * Checks if a tool blocks the thought loop.
 */
function isBlockingTool(toolName: string): boolean {
  return ['ask_user', 'request_task_approval'].includes(toolName)
}

// ============================================================================
// Loop Controller Class
// ============================================================================

export interface LoopControllerOptions {
  log: ConversationLog
  settings: MarkusSettings
  workspaceFolders: string[]
  filebarId: string
  mainWindow: BrowserWindow
  getOpenFiles: () => string[]
  onEvent: ThoughtLoopEventHandler
  yoloMode: boolean
  waitForToolApproval: (conversationId: string, toolCall: ToolCallRecord) => Promise<boolean>
  abortSignal?: AbortSignal
}

export class LoopController {
  private state: LoopState = 'idle'
  private config = DEFAULT_LOOP_CONFIG
  private noToolRetries = 0
  private previousResponses: string[] = []

  constructor(private options: LoopControllerOptions) {}

  /**
   * Runs the thought loop until a stop condition is met.
   * Returns the stop condition that ended the loop.
   */
  async run(): Promise<{
    stopCondition: StopCondition
    waitingForInput: boolean
    blockingToolCall?: ToolCallLog
  }> {
    const {
      log,
      settings,
      workspaceFolders,
      filebarId,
      mainWindow,
      getOpenFiles,
      onEvent,
      abortSignal
    } = this.options

    this.state = 'thinking'
    let iteration = 0

    const client = createLLMClient(settings.llm)

    while (iteration < this.config.maxIterations) {
      iteration++
      console.log(`[LoopController] Iteration ${iteration}`)

      onEvent({ type: 'iteration_started', iterationIndex: iteration - 1 })

      // Check for abort
      if (abortSignal?.aborted) {
        return {
          stopCondition: 'user_cancelled',
          waitingForInput: false
        }
      }

      // Load current task list
      let taskList = await loadTaskList(filebarId, log.id)
      if (!taskList) {
        taskList = createTaskList(log.id)
      }

      // Build context algorithmically
      const context = log.iterations.length === 0 && log.userMessages.length === 1
        ? await buildInitialContext(
            log.userMessages[0].content,
            workspaceFolders,
            log.mode,
            { tasks: taskList.tasks, updatedAt: taskList.updatedAt }
          )
        : await buildContext(log, workspaceFolders, {
            mode: log.mode,
            tasks: { tasks: taskList.tasks, updatedAt: taskList.updatedAt }
          })

      const llmMessages = contextToLLMMessages(context)

      // Stream LLM response
      const startedAt = Date.now()
      let fullContent = ''

      try {
        for await (const chunk of client.chatStream(
          llmMessages,
          TOOL_DEFINITIONS,
          abortSignal
        )) {
          if (chunk.type === 'content' && chunk.content) {
            fullContent += chunk.content
            onEvent({ type: 'llm_streaming', chunk: chunk.content })
          }
        }
      } catch (error) {
        if (abortSignal?.aborted) {
          return { stopCondition: 'user_cancelled', waitingForInput: false }
        }
        throw error
      }

      const llmCompletedAt = Date.now()

      // Parse response
      const { textContent, toolCalls } = parseContentForToolCalls(fullContent)
      const strippedContent = stripReasoningContent(textContent)

      const responseData: LLMResponseData = {
        rawContent: fullContent,
        strippedContent,
        parsedToolCalls: toolCalls,
        hasToolCalls: toolCalls.length > 0,
        model: settings.llm.model
      }

      onEvent({ type: 'llm_complete', response: responseData })

      // Check for repetition
      const normalizedResponse = strippedContent.toLowerCase().trim().substring(0, 200)
      if (normalizedResponse && this.previousResponses.some(prev =>
        prev.toLowerCase().trim().substring(0, 200) === normalizedResponse
      )) {
        console.log('[LoopController] Detected repetition')

        const iterationData = this.createIteration(
          iteration - 1,
          log.mode,
          context,
          responseData,
          [],
          startedAt,
          llmCompletedAt,
          { type: 'repetition_detected' }
        )
        addIteration(log, iterationData)
        await saveLog(log)

        return { stopCondition: 'repetition_detected', waitingForInput: false }
      }
      this.previousResponses.push(strippedContent)

      // Handle no tool calls
      if (toolCalls.length === 0) {
        this.noToolRetries++
        console.log(`[LoopController] No tool calls (retry ${this.noToolRetries}/${this.config.maxNoToolRetries})`)

        if (this.noToolRetries >= this.config.maxNoToolRetries) {
          const iterationData = this.createIteration(
            iteration - 1,
            log.mode,
            context,
            responseData,
            [],
            startedAt,
            llmCompletedAt,
            { type: 'max_no_tool_retries', retryCount: this.noToolRetries }
          )
          addIteration(log, iterationData)
          await saveLog(log)

          return { stopCondition: 'max_no_tool_retries', waitingForInput: false }
        }

        // Add reminder and continue
        addUserMessage(
          log,
          '[System] You MUST call a tool in every response. Use update_tasks to track progress, consult_boss to show messages, or other tools to do work. Text outside tool calls is invisible to the user.'
        )

        onEvent({ type: 'llm_streaming', chunk: '' }) // Signal new iteration
        continue
      }

      // Reset retry counter
      this.noToolRetries = 0
      this.state = 'executing'

      // Execute tool calls
      const toolCallLogs: ToolCallLog[] = []
      let endState: IterationEndState = { type: 'continue' }

      for (const toolCallData of toolCalls) {
        const toolCallLog: ToolCallLog = {
          id: toolCallData.id,
          name: toolCallData.name,
          arguments: toolCallData.arguments,
          status: 'pending',
          startedAt: Date.now(),
          blocking: isBlockingTool(toolCallData.name)
        }

        toolCallLogs.push(toolCallLog)
        onEvent({ type: 'tool_started', toolCall: toolCallLog })

        // Check if approval needed
        let shouldExecute = this.options.yoloMode || isThoughtLoopTool(toolCallData.name) || isSafeTool(toolCallData.name)

        if (!shouldExecute) {
          const toolCallRecord: ToolCallRecord = {
            id: toolCallData.id,
            name: toolCallData.name,
            arguments: toolCallData.arguments,
            status: 'pending',
            startedAt: Date.now()
          }

          mainWindow.webContents.send('markus:toolCallStarted', {
            conversationId: log.id,
            toolCall: toolCallRecord
          })

          shouldExecute = await this.options.waitForToolApproval(log.id, toolCallRecord)
        }

        if (shouldExecute) {
          toolCallLog.status = 'executing'

          const context: ToolContext = {
            workspaceFolders,
            openFiles: getOpenFiles(),
            mainWindow,
            filebarId,
            conversationId: log.id
          }

          try {
            const result = await executeTool(toolCallData.name, toolCallData.arguments, context)

            toolCallLog.status = result.success ? 'complete' : 'error'
            toolCallLog.completedAt = Date.now()
            toolCallLog.result = {
              success: result.success,
              data: result.result,
              error: result.error
            }

            // Cache file content for read_file
            if (toolCallData.name === 'read_file' && result.success && typeof result.result === 'string') {
              toolCallLog.cachedContent = result.result
            }

            // Handle blocking UI
            if (result.blocking && result.uiData) {
              toolCallLog.blocking = true
              toolCallLog.uiData = result.uiData

              mainWindow.webContents.send('markus:blockingTool', {
                conversationId: log.id,
                toolCallId: toolCallLog.id,
                uiData: result.uiData
              })

              endState = {
                type: 'blocking_tool',
                toolName: toolCallData.name,
                toolCallId: toolCallLog.id
              }
            }

            // Send tool completion to frontend
            const toolResult: ToolCallResult = {
              success: result.success,
              data: result.result,
              error: result.error
            }
            onEvent({ type: 'tool_complete', toolCallId: toolCallLog.id, result: toolResult })

            mainWindow.webContents.send('markus:toolCallComplete', {
              conversationId: log.id,
              toolCallId: toolCallLog.id,
              result
            })

            // Auto-open files
            if (result.openFile) {
              mainWindow.webContents.send('file:openPath', result.openFile)
            }

            if (endState.type === 'blocking_tool') {
              break
            }
          } catch (error) {
            toolCallLog.status = 'error'
            toolCallLog.completedAt = Date.now()
            toolCallLog.result = {
              success: false,
              error: String(error)
            }
          }
        } else {
          toolCallLog.status = 'rejected'
          toolCallLog.completedAt = Date.now()
          toolCallLog.result = {
            success: false,
            error: 'Tool call was rejected by user'
          }
        }
      }

      // Update task list in log
      const updatedTaskList = await loadTaskList(filebarId, log.id)
      if (updatedTaskList) {
        updateTasks(log, {
          tasks: updatedTaskList.tasks,
          updatedAt: updatedTaskList.updatedAt
        })

        mainWindow.webContents.send('markus:tasksUpdated', {
          conversationId: log.id,
          tasks: updatedTaskList.tasks
        })
      }

      // Check if all tools were rejected
      if (toolCallLogs.every(tc => tc.status === 'rejected')) {
        endState = { type: 'all_rejected' as const }
      }

      // Create iteration record
      const iterationData = this.createIteration(
        iteration - 1,
        log.mode,
        context,
        responseData,
        toolCallLogs,
        startedAt,
        llmCompletedAt,
        endState
      )
      addIteration(log, iterationData)
      await saveLog(log)

      onEvent({ type: 'iteration_complete', iteration: { ...iterationData, id: uuidv4(), index: iteration - 1 } })

      // Handle end states
      if (endState.type === 'blocking_tool') {
        const blockingToolCall = toolCallLogs.find(tc => tc.id === (endState as { toolCallId: string }).toolCallId)

        onEvent({
          type: 'loop_blocked',
          reason: `Waiting for ${(endState as { toolName: string }).toolName}`,
          uiData: blockingToolCall?.uiData
        })

        return {
          stopCondition: 'blocking_tool',
          waitingForInput: true,
          blockingToolCall
        }
      }

      if (endState.type === 'all_rejected') {
        return { stopCondition: 'all_rejected', waitingForInput: false }
      }

      // Continue to next iteration
      this.state = 'thinking'
      onEvent({ type: 'llm_streaming', chunk: '' }) // Signal new iteration
    }

    // Max iterations reached
    return { stopCondition: 'max_iterations', waitingForInput: false }
  }

  /**
   * Creates an iteration record for logging.
   */
  private createIteration(
    _index: number,
    mode: 'planning' | 'execution',
    context: BuiltContext,
    response: LLMResponseData,
    toolCalls: ToolCallLog[],
    startedAt: number,
    llmCompletedAt: number,
    endState: IterationEndState
  ): Omit<ThoughtIteration, 'id' | 'index'> {
    return {
      mode,
      request: createRequestContext(context),
      response,
      toolCalls,
      timing: {
        startedAt,
        llmCompletedAt,
        toolsCompletedAt: toolCalls.length > 0 ? Date.now() : undefined,
        endedAt: Date.now()
      },
      endState
    }
  }
}

/**
 * Creates and runs a loop controller.
 */
export async function runThoughtLoop(options: LoopControllerOptions): Promise<{
  stopCondition: StopCondition
  waitingForInput: boolean
  blockingToolCall?: ToolCallLog
}> {
  const controller = new LoopController(options)
  return controller.run()
}
