/**
 * Context Builder
 *
 * Implements algorithmic context fabrication for the thought loop.
 * Instead of blindly including the full conversation history, this module
 * builds each LLM request context by cherry-picking relevant data:
 *
 * Always included:
 * - System prompt with mode-specific instructions
 * - All user messages (original + ask_user responses)
 * - All consult_boss messages (agent's output to user)
 * - All file read results (cached, most recent per file)
 * - Current task list state
 *
 * Mode-specific:
 * - Planning: Focus on understanding, all file reads in full
 * - Execution: Focus on doing, recent iterations, recent file reads
 */

import { generateToolSchema } from '../llm'
import { TOOL_DEFINITIONS } from '../tools'
import { getAllContext } from '../memory'
import { formatTaskListForPrompt } from '../tasks'
import type {
  ConversationLog,
  BuiltContext,
  ContextBuildOptions,
  ContextSource,
  LLMContextMessage,
  TaskState
} from './types'
import {
  getConsultBossMessages,
  getFileReadCache,
  getRecentIterations,
  summarizeIteration
} from './logManager'

// ============================================================================
// Constants
// ============================================================================

/** Approximate chars per token for estimation */
const CHARS_PER_TOKEN = 4

/** Max characters for file content in execution mode */
const MAX_FILE_CHARS_EXECUTION = 10000

/** Number of recent iterations to include in execution mode */
const RECENT_ITERATIONS_COUNT = 5

// ============================================================================
// System Prompt Building
// ============================================================================

/**
 * Builds the base system prompt with mode-specific instructions.
 */
export async function buildSystemPrompt(
  workspaceFolders: string[],
  mode: 'planning' | 'execution',
  tasks: TaskState
): Promise<{ prompt: string; sources: ContextSource[] }> {
  const sources: ContextSource[] = []

  // Get memory context
  const context = await getAllContext(workspaceFolders)
  const toolSchema = generateToolSchema(TOOL_DEFINITIONS)

  let systemPrompt = `You are Markus, an AI assistant integrated into a markdown editor.

## CRITICAL RULES (MUST FOLLOW)

1. **You MUST call a tool in every response** - NO EXCEPTIONS
2. **The user (boss) can ONLY see content inside tool calls**
3. To show anything to the user, use the \`consult_boss\` tool
4. **Any text outside tool calls is INVISIBLE to the user**
5. If you're not sure what to do, call \`update_tasks\` to review progress
6. When all tasks are done, call \`request_task_approval\`
7. If you need user input, call \`ask_user\` with clickable options

## REMEMBER: Text outside tool calls = invisible to boss!

## Available Tools (in priority order)

1. **consult_boss** - Show messages to user (ONLY way to communicate!)
2. **update_tasks** - Add/complete/remove tasks (call first each turn to maintain focus)
3. **ask_user** - Ask user with predefined options (PAUSES for input)
4. **request_task_approval** - Submit completed work for approval (PAUSES)
5. **consult_*_agent** - Get specialist input (non-blocking)
6. **read_file, edit_file, create_file, list_directory, search_files** - Do the work

## Current Mode: ${mode.toUpperCase()}

`

  sources.push({
    type: 'system_prompt',
    charCount: systemPrompt.length
  })

  // Add mode-specific instructions
  const modeInstructions = mode === 'planning'
    ? `In PLANNING mode:
- Focus on understanding the task and gathering information
- Use read-only tools to analyze files and understand context
- Create a task list with update_tasks
- When ready to execute, tell the user via consult_boss
`
    : `In EXECUTION mode:
- You have permission to create and edit files
- Work through your task list systematically
- Use update_tasks to mark progress
- When done, call request_task_approval
`

  systemPrompt += modeInstructions + '\n'
  sources.push({
    type: 'mode_instructions',
    charCount: modeInstructions.length
  })

  // Add specialist agent info
  systemPrompt += `## Your Specialist Agents

You have a team of specialist agents you can delegate tasks to:

- **Research Agent** (consult_research_agent): Deep file exploration and analysis
- **Critique Agent** (consult_critique_agent): Quality review and validation
- **Style Agent** (consult_style_agent): Formatting and writing polish
- **Creative Agent** (consult_creative_agent): Ideas and brainstorming

**IMPORTANT - Agent Context Rules:**
1. Agents can ONLY see the task description you give them + the files in the workspace
2. Agents CANNOT see your conversation history with the user
3. You MUST include ALL relevant context in your task description
4. Be explicit and detailed - agents work best with clear, complete context

`

  // Add tool schema
  systemPrompt += toolSchema + '\n\n'

  // Inject task list
  if (tasks.tasks.length > 0) {
    const taskListPrompt = formatTaskListForPrompt({
      conversationId: '',
      tasks: tasks.tasks,
      createdAt: tasks.updatedAt,
      updatedAt: tasks.updatedAt
    })
    systemPrompt += taskListPrompt + '\n\n'
    sources.push({
      type: 'task_list',
      charCount: taskListPrompt.length
    })
  } else {
    const noTasksPrompt = `## Tasks

No tasks defined yet. When you receive a request:
1. First, use update_tasks to create your task list
2. Then work through the tasks systematically
3. Use consult_boss to communicate progress
4. When done, call request_task_approval

`
    systemPrompt += noTasksPrompt
    sources.push({
      type: 'task_list',
      charCount: noTasksPrompt.length
    })
  }

  // Add memory context
  if (context.systemInstructions) {
    const section = `## Global Instructions\n\n${context.systemInstructions}\n\n`
    systemPrompt += section
    sources.push({
      type: 'memory',
      reference: 'system_instructions',
      charCount: section.length
    })
  }

  if (context.projectInstructions) {
    const section = `## Project Instructions\n\n${context.projectInstructions}\n\n`
    systemPrompt += section
    sources.push({
      type: 'memory',
      reference: 'project_instructions',
      charCount: section.length
    })
  }

  if (context.systemMemory) {
    const section = `## Memory (Global)\n\n${context.systemMemory}\n\n`
    systemPrompt += section
    sources.push({
      type: 'memory',
      reference: 'system_memory',
      charCount: section.length
    })
  }

  if (context.projectMemory) {
    const section = `## Memory (Project)\n\n${context.projectMemory}\n\n`
    systemPrompt += section
    sources.push({
      type: 'memory',
      reference: 'project_memory',
      charCount: section.length
    })
  }

  return { prompt: systemPrompt, sources }
}

// ============================================================================
// Context Building
// ============================================================================

/**
 * Builds the complete context for an LLM request.
 * This is the core of algorithmic context fabrication.
 */
export async function buildContext(
  log: ConversationLog,
  workspaceFolders: string[],
  options: ContextBuildOptions
): Promise<BuiltContext> {
  const sources: ContextSource[] = []
  const messages: LLMContextMessage[] = []

  // Build system prompt
  const { prompt: systemPrompt, sources: promptSources } = await buildSystemPrompt(
    workspaceFolders,
    options.mode,
    options.tasks
  )
  sources.push(...promptSources)

  // Collect all user messages
  const userMessagesContent = log.userMessages
    .map(msg => {
      if (msg.inResponseTo) {
        return `[Response to: "${msg.inResponseTo.question}"]\n${msg.content}`
      }
      return msg.content
    })
    .join('\n\n---\n\n')

  if (userMessagesContent) {
    messages.push({
      role: 'user',
      content: userMessagesContent,
      source: 'user_messages'
    })
    sources.push({
      type: 'user_message',
      charCount: userMessagesContent.length
    })
  }

  // Collect consult_boss messages (what agent said to user)
  const consultBossMessages = getConsultBossMessages(log)
  if (consultBossMessages.length > 0) {
    const consultContent = consultBossMessages
      .map(m => `[${m.type.toUpperCase()}] ${m.message}`)
      .join('\n\n')

    messages.push({
      role: 'assistant',
      content: `[Previous messages to user]:\n\n${consultContent}`,
      source: 'consult_boss'
    })
    sources.push({
      type: 'consult_boss',
      charCount: consultContent.length
    })
  }

  // Handle file reads based on mode
  const fileCache = getFileReadCache(log)
  if (fileCache.size > 0) {
    let fileContent = '[Files read]:\n\n'

    for (const [path, cached] of fileCache) {
      let content = cached.content

      // In execution mode, truncate long files
      if (options.mode === 'execution' && content.length > MAX_FILE_CHARS_EXECUTION) {
        content = content.substring(0, MAX_FILE_CHARS_EXECUTION) + '\n... (truncated)'
        sources.push({
          type: 'file_read',
          reference: path,
          charCount: MAX_FILE_CHARS_EXECUTION,
          truncated: true
        })
      } else {
        sources.push({
          type: 'file_read',
          reference: path,
          charCount: content.length
        })
      }

      fileContent += `--- ${path} ---\n${content}\n\n`
    }

    messages.push({
      role: 'assistant',
      content: fileContent,
      source: 'file_cache'
    })
  }

  // Add iteration context based on mode
  if (options.mode === 'execution' && log.iterations.length > 0) {
    // In execution mode, include summaries of recent iterations
    const recentIterations = getRecentIterations(log, RECENT_ITERATIONS_COUNT)
    const summaries = recentIterations.map(summarizeIteration).join('\n')

    if (summaries) {
      messages.push({
        role: 'assistant',
        content: `[Recent actions]:\n${summaries}`,
        source: 'iteration_summaries'
      })
      sources.push({
        type: 'iteration_summary',
        charCount: summaries.length
      })
    }
  }

  // Add tool results from the most recent iteration if it didn't end in blocking
  if (log.iterations.length > 0) {
    const lastIteration = log.iterations[log.iterations.length - 1]
    if (lastIteration.endState.type === 'continue') {
      const toolResults = lastIteration.toolCalls
        .filter(tc => tc.status === 'complete' && tc.result)
        .map(tc => {
          const resultStr = typeof tc.result?.data === 'string'
            ? tc.result.data
            : JSON.stringify(tc.result?.data)
          return `Tool "${tc.name}":\n${resultStr}`
        })
        .join('\n\n---\n\n')

      if (toolResults) {
        messages.push({
          role: 'user',
          content: `[Tool Results]\n\n${toolResults}\n\nContinue working. Remember to use tools - text outside tools is invisible.`,
          source: 'tool_results'
        })
        sources.push({
          type: 'tool_result',
          charCount: toolResults.length
        })
      }
    }
  }

  // Add continuation prompt
  const continuationPrompt = options.mode === 'planning'
    ? 'Continue analyzing. Use tools to gather information and create your task list.'
    : 'Continue executing. Mark tasks complete as you finish them.'

  messages.push({
    role: 'user',
    content: continuationPrompt,
    source: 'continuation'
  })

  // Estimate tokens
  const totalChars = systemPrompt.length + messages.reduce((acc, m) => acc + m.content.length, 0)
  const estimatedTokens = Math.ceil(totalChars / CHARS_PER_TOKEN)

  return {
    messages,
    systemPrompt,
    sources,
    estimatedTokens
  }
}

/**
 * Builds context for the first message in a conversation.
 * Simpler than buildContext since there's no history to process.
 */
export async function buildInitialContext(
  userMessage: string,
  workspaceFolders: string[],
  mode: 'planning' | 'execution',
  tasks: TaskState
): Promise<BuiltContext> {
  const sources: ContextSource[] = []

  // Build system prompt
  const { prompt: systemPrompt, sources: promptSources } = await buildSystemPrompt(
    workspaceFolders,
    mode,
    tasks
  )
  sources.push(...promptSources)

  // Single user message
  const messages: LLMContextMessage[] = [
    {
      role: 'user',
      content: userMessage,
      source: 'initial_message'
    }
  ]
  sources.push({
    type: 'user_message',
    charCount: userMessage.length
  })

  const totalChars = systemPrompt.length + userMessage.length
  const estimatedTokens = Math.ceil(totalChars / CHARS_PER_TOKEN)

  return {
    messages,
    systemPrompt,
    sources,
    estimatedTokens
  }
}

/**
 * Converts built context to LLM message format.
 */
export function contextToLLMMessages(context: BuiltContext): Array<{
  role: 'user' | 'assistant' | 'system'
  content: string
}> {
  const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [
    { role: 'system', content: context.systemPrompt }
  ]

  for (const msg of context.messages) {
    messages.push({
      role: msg.role,
      content: msg.content
    })
  }

  return messages
}

/**
 * Creates an LLMRequestContext for logging.
 */
export function createRequestContext(context: BuiltContext): {
  systemPrompt: string
  messages: LLMContextMessage[]
  contextSources: ContextSource[]
  estimatedTokens: number
} {
  return {
    systemPrompt: context.systemPrompt,
    messages: context.messages,
    contextSources: context.sources,
    estimatedTokens: context.estimatedTokens
  }
}
