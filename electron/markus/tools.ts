/**
 * Markus Tools System
 *
 * Defines all available tools for the AI agent and their execution logic.
 * Tools are sandboxed to only operate within filebar workspace directories.
 */

import fs from 'fs/promises'
import path from 'path'
import { existsSync } from 'fs'
import { ToolDefinition, ToolResult, ToolContext, MemoryUpdateRequest, Task } from './types'
import {
  validateReadPath,
  validateWritePath,
  validateDirectoryPath,
  validateEditOperation,
  isFile,
  isDirectory,
  PathSecurityError
} from './security'
import {
  isInitialized as isMultiAgentInitialized,
  routeUserMessage
} from './multiAgent'
import { AgentType } from './agents/types'
import {
  loadTaskList,
  saveTaskList,
  createTaskList,
  addTask,
  updateTaskStatus,
  updateTaskDescription,
  removeTask,
  completeTasks,
  formatTaskListForPrompt
} from './tasks'

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * All available tool definitions for the LLM.
 */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Read the contents of a file. Returns the file content as text.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute or relative path to the file to read'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'list_directory',
    description: 'List files and directories in a given path.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the directory to list'
        },
        recursive: {
          type: 'boolean',
          description: 'Whether to list recursively (default: false)'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'edit_file',
    description: 'Edit a file by replacing a specific string with a new string. The old_string must exist in the file.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file to edit'
        },
        old_string: {
          type: 'string',
          description: 'The exact string to find and replace'
        },
        new_string: {
          type: 'string',
          description: 'The string to replace it with'
        }
      },
      required: ['path', 'old_string', 'new_string']
    }
  },
  {
    name: 'create_file',
    description: 'Create a new file with the given content. The file will be opened in the editor.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path for the new file'
        },
        content: {
          type: 'string',
          description: 'Content to write to the file'
        }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'delete_file',
    description: 'Delete a file from the filesystem.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file to delete'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'create_directory',
    description: 'Create a new directory.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path for the new directory'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'search_files',
    description: 'Search for text patterns in files within a directory.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Text pattern to search for'
        },
        path: {
          type: 'string',
          description: 'Directory to search in (optional, defaults to first workspace folder)'
        },
        file_pattern: {
          type: 'string',
          description: 'File glob pattern to match (e.g., "*.ts", "*.md")'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'search_web',
    description: 'Search the web using SearxNG. Requires SearxNG to be configured.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'duck_ai',
    description: 'Get a quick answer using DuckDuckGo AI.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Question to ask'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'get_open_files',
    description: 'Get the list of currently open files in the editor.',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'get_workspace_folders',
    description: 'Get the list of workspace folders currently open in the filebar.',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'update_memory',
    description: 'Update Markus memory to remember information for future conversations. Requires user confirmation.',
    parameters: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          description: 'Where to store: "system" (global) or "project" (workspace-specific)',
          enum: ['system', 'project']
        },
        action: {
          type: 'string',
          description: 'What to do: "add", "update", or "remove"',
          enum: ['add', 'update', 'remove']
        },
        section: {
          type: 'string',
          description: 'Section header for the memory (e.g., "User Preferences", "Project Context")'
        },
        content: {
          type: 'string',
          description: 'Content to add/update in this section'
        }
      },
      required: ['scope', 'action', 'section', 'content']
    }
  },
  // Agent delegation tools - consult specialist agents for specific tasks
  {
    name: 'consult_research_agent',
    description: 'Ask the Research agent to search files, analyze code, or gather information. Use for deep file exploration and understanding.',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'What you want the research agent to find or analyze'
        },
        context: {
          type: 'string',
          description: 'Additional context about what you are working on'
        }
      },
      required: ['task']
    }
  },
  {
    name: 'consult_critique_agent',
    description: 'Ask the Critique agent to review content, check for issues, or validate your work. Use for quality assurance.',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'What you want reviewed or critiqued'
        },
        content: {
          type: 'string',
          description: 'The content to review (optional if referring to a file)'
        }
      },
      required: ['task']
    }
  },
  {
    name: 'consult_style_agent',
    description: 'Ask the Style agent to improve formatting, voice, tone, or consistency. Use for polishing text.',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'What style improvements you need'
        },
        content: {
          type: 'string',
          description: 'The content to style (optional if referring to a file)'
        }
      },
      required: ['task']
    }
  },
  {
    name: 'consult_creative_agent',
    description: 'Ask the Creative agent for ideas, brainstorming, or creative solutions. Use for generating options or thinking outside the box.',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'What creative input you need'
        },
        context: {
          type: 'string',
          description: 'Background context for the creative task'
        }
      },
      required: ['task']
    }
  },
  // Thought loop tools - for proactive agent behavior
  {
    name: 'consult_boss',
    description: 'Show a message to the user. The boss can ONLY see content inside this tool call. Any text outside tool calls is invisible to the user. Use this to communicate progress, findings, or results.',
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'The message to display to the user (supports markdown)'
        },
        type: {
          type: 'string',
          description: 'Message type for styling',
          enum: ['info', 'success', 'warning', 'error', 'progress']
        }
      },
      required: ['message']
    }
  },
  {
    name: 'update_tasks',
    description: 'Update the task list. Call this first in each iteration to track your progress and maintain focus.',
    parameters: {
      type: 'object',
      properties: {
        add: {
          type: 'array',
          description: 'Tasks to add. Each task has a description and optional priority (higher = more important).'
        },
        complete: {
          type: 'array',
          description: 'Task IDs to mark as done'
        },
        remove: {
          type: 'array',
          description: 'Task IDs to remove from the list'
        },
        update: {
          type: 'array',
          description: 'Tasks to update. Each update has id and optional status/description.'
        }
      }
    }
  },
  {
    name: 'ask_user',
    description: 'Ask the user a question with predefined clickable options. This PAUSES the thought loop until the user responds. Use sparingly - only when you truly need user input to proceed.',
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The question to ask the user'
        },
        options: {
          type: 'array',
          description: 'Clickable options (2-5). An "Other" option with text input is always added automatically.'
        },
        reason: {
          type: 'string',
          description: 'Brief explanation of why this input is needed'
        }
      },
      required: ['question', 'options']
    }
  },
  {
    name: 'request_task_approval',
    description: 'Request approval when all tasks are complete. This PAUSES the thought loop for user review. Only call this when you have finished all the work.',
    parameters: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'Summary of the completed work'
        },
        files_changed: {
          type: 'array',
          description: 'List of files that were modified'
        }
      },
      required: ['summary']
    }
  }
]

// ============================================================================
// Result Size Limits
// ============================================================================

const MAX_FILE_CONTENT_LENGTH = 10000 // Max characters for file content
const MAX_DIRECTORY_ENTRIES = 100 // Max entries for directory listing
const MAX_DIRECTORY_DEPTH = 3 // Max depth for recursive listing
const MAX_SEARCH_RESULTS = 50 // Max search results

/**
 * Truncates a string result if it's too long.
 */
function truncateResult(content: string, maxLength: number = MAX_FILE_CONTENT_LENGTH): string {
  if (content.length <= maxLength) {
    return content
  }
  return content.substring(0, maxLength) + `\n\n[... truncated, ${content.length - maxLength} more characters ...]`
}

// ============================================================================
// Tool Execution
// ============================================================================

/**
 * Executes a tool with the given arguments.
 */
export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  try {
    switch (toolName) {
      case 'read_file':
        return await executeReadFile(args, context)
      case 'list_directory':
        return await executeListDirectory(args, context)
      case 'edit_file':
        return await executeEditFile(args, context)
      case 'create_file':
        return await executeCreateFile(args, context)
      case 'delete_file':
        return await executeDeleteFile(args, context)
      case 'create_directory':
        return await executeCreateDirectory(args, context)
      case 'search_files':
        return await executeSearchFiles(args, context)
      case 'search_web':
        return await executeSearchWeb(args)
      case 'duck_ai':
        return await executeDuckAi(args)
      case 'get_open_files':
        return executeGetOpenFiles(context)
      case 'get_workspace_folders':
        return executeGetWorkspaceFolders(context)
      case 'update_memory':
        return await executeUpdateMemory(args)
      case 'consult_research_agent':
        return await executeConsultAgent('research', args, context)
      case 'consult_critique_agent':
        return await executeConsultAgent('critique', args, context)
      case 'consult_style_agent':
        return await executeConsultAgent('style', args, context)
      case 'consult_creative_agent':
        return await executeConsultAgent('creative', args, context)
      // Thought loop tools
      case 'consult_boss':
        return executeConsultBoss(args)
      case 'update_tasks':
        return await executeUpdateTasks(args, context)
      case 'ask_user':
        return executeAskUser(args)
      case 'request_task_approval':
        return executeRequestApproval(args)
      default:
        return { success: false, error: `Unknown tool: ${toolName}` }
    }
  } catch (error) {
    if (error instanceof PathSecurityError) {
      return { success: false, error: error.message }
    }
    return { success: false, error: String(error) }
  }
}

// ============================================================================
// Individual Tool Implementations
// ============================================================================

async function executeReadFile(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const filePath = String(args.path || '')
  if (!filePath) {
    return { success: false, error: 'Path is required' }
  }

  const validatedPath = validateReadPath(filePath, context.workspaceFolders)

  if (!isFile(validatedPath)) {
    return { success: false, error: `File not found: ${filePath}` }
  }

  const content = await fs.readFile(validatedPath, 'utf-8')
  // Truncate very long files to prevent context overflow
  // Include file path in result so LLM knows which file it's seeing
  const formattedResult = `File: ${filePath}\n${'─'.repeat(40)}\n${truncateResult(content)}`
  return { success: true, result: formattedResult }
}

async function executeListDirectory(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const dirPath = String(args.path || '')
  const recursive = Boolean(args.recursive)

  if (!dirPath) {
    return { success: false, error: 'Path is required' }
  }

  const validatedPath = validateDirectoryPath(dirPath, context.workspaceFolders)

  if (!isDirectory(validatedPath)) {
    return { success: false, error: `Directory not found: ${dirPath}` }
  }

  const entries = await listDirectoryRecursive(validatedPath, recursive, 0)

  // Add truncation notice if we hit the limit
  if (entries.length >= MAX_DIRECTORY_ENTRIES) {
    return {
      success: true,
      result: entries,
      warning: `Results limited to ${MAX_DIRECTORY_ENTRIES} entries. Use a more specific path to see more.`
    }
  }

  return { success: true, result: entries }
}

async function listDirectoryRecursive(
  dirPath: string,
  recursive: boolean,
  currentDepth: number,
  basePath?: string
): Promise<Array<{ name: string; path: string; type: 'file' | 'directory' }>> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  const result: Array<{ name: string; path: string; type: 'file' | 'directory' }> = []
  const base = basePath || dirPath

  for (const entry of entries) {
    // Stop if we've hit the max entries limit
    if (result.length >= MAX_DIRECTORY_ENTRIES) {
      break
    }

    // Skip hidden files and common ignore patterns
    if (entry.name.startsWith('.') || entry.name === 'node_modules') {
      continue
    }

    const fullPath = path.join(dirPath, entry.name)
    const relativePath = path.relative(base, fullPath)

    if (entry.isDirectory()) {
      result.push({ name: entry.name, path: relativePath, type: 'directory' })

      // Only recurse if we haven't hit depth limit and haven't hit entry limit
      if (recursive && currentDepth < MAX_DIRECTORY_DEPTH && result.length < MAX_DIRECTORY_ENTRIES) {
        try {
          const subEntries = await listDirectoryRecursive(fullPath, true, currentDepth + 1, base)
          // Only add entries up to the limit
          const remaining = MAX_DIRECTORY_ENTRIES - result.length
          result.push(...subEntries.slice(0, remaining))
        } catch {
          // Skip directories we can't read
        }
      }
    } else {
      result.push({ name: entry.name, path: relativePath, type: 'file' })
    }
  }

  return result
}

async function executeEditFile(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const filePath = String(args.path || '')
  const oldString = String(args.old_string || '')
  const newString = String(args.new_string || '')

  if (!filePath) {
    return { success: false, error: 'Path is required' }
  }
  if (!oldString) {
    return { success: false, error: 'old_string is required' }
  }

  const validatedPath = validateWritePath(filePath, context.workspaceFolders)

  if (!isFile(validatedPath)) {
    return { success: false, error: `File not found: ${filePath}` }
  }

  const content = await fs.readFile(validatedPath, 'utf-8')
  const validation = validateEditOperation(filePath, oldString, content)

  if (!validation.valid) {
    return { success: false, error: validation.error }
  }

  if (validation.occurrences > 1) {
    return {
      success: false,
      error: `The string to replace occurs ${validation.occurrences} times. Please provide more context to make it unique.`
    }
  }

  const newContent = content.replace(oldString, newString)
  await fs.writeFile(validatedPath, newContent, 'utf-8')

  return {
    success: true,
    result: `File edited successfully: ${filePath}`,
    openFile: validatedPath
  }
}

async function executeCreateFile(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const filePath = String(args.path || '')
  const content = String(args.content || '')

  if (!filePath) {
    return { success: false, error: 'Path is required' }
  }

  const validatedPath = validateWritePath(filePath, context.workspaceFolders)

  if (existsSync(validatedPath)) {
    return { success: false, error: `File already exists: ${filePath}. Use edit_file to modify it.` }
  }

  await fs.writeFile(validatedPath, content, 'utf-8')

  return {
    success: true,
    result: `File created successfully: ${filePath}`,
    openFile: validatedPath
  }
}

async function executeDeleteFile(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const filePath = String(args.path || '')

  if (!filePath) {
    return { success: false, error: 'Path is required' }
  }

  const validatedPath = validateWritePath(filePath, context.workspaceFolders)

  if (!existsSync(validatedPath)) {
    return { success: false, error: `File not found: ${filePath}` }
  }

  await fs.unlink(validatedPath)

  return { success: true, result: `File deleted successfully: ${filePath}` }
}

async function executeCreateDirectory(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const dirPath = String(args.path || '')

  if (!dirPath) {
    return { success: false, error: 'Path is required' }
  }

  const validatedPath = validateDirectoryPath(dirPath, context.workspaceFolders)

  if (existsSync(validatedPath)) {
    return { success: false, error: `Directory already exists: ${dirPath}` }
  }

  await fs.mkdir(validatedPath, { recursive: true })

  return { success: true, result: `Directory created successfully: ${dirPath}` }
}

async function executeSearchFiles(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const query = String(args.query || '')
  const searchPath = args.path ? String(args.path) : context.workspaceFolders[0]
  const filePattern = args.file_pattern ? String(args.file_pattern) : '*'

  if (!query) {
    return { success: false, error: 'Query is required' }
  }

  if (!searchPath) {
    return { success: false, error: 'No workspace folder available for search' }
  }

  const validatedPath = validateDirectoryPath(searchPath, context.workspaceFolders)
  const results = await searchInDirectory(validatedPath, query, filePattern)

  return { success: true, result: results }
}

async function searchInDirectory(
  dirPath: string,
  query: string,
  filePattern: string
): Promise<Array<{ file: string; line: number; content: string }>> {
  const results: Array<{ file: string; line: number; content: string }> = []
  const queryLower = query.toLowerCase()

  async function searchDir(currentPath: string) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true })

    for (const entry of entries) {
      // Skip hidden files and node_modules
      if (entry.name.startsWith('.') || entry.name === 'node_modules') {
        continue
      }

      const fullPath = path.join(currentPath, entry.name)

      if (entry.isDirectory()) {
        await searchDir(fullPath)
      } else if (matchesPattern(entry.name, filePattern)) {
        try {
          const content = await fs.readFile(fullPath, 'utf-8')
          const lines = content.split('\n')

          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(queryLower)) {
              results.push({
                file: fullPath,
                line: i + 1,
                content: lines[i].trim().substring(0, 200)
              })

              // Limit results per file
              if (results.filter(r => r.file === fullPath).length >= 5) {
                break
              }
            }
          }
        } catch {
          // Skip files we can't read
        }
      }

      // Limit total results
      if (results.length >= MAX_SEARCH_RESULTS) {
        return
      }
    }
  }

  await searchDir(dirPath)
  return results
}

function matchesPattern(filename: string, pattern: string): boolean {
  if (pattern === '*') return true

  // Simple glob matching
  const regex = new RegExp(
    '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$',
    'i'
  )
  return regex.test(filename)
}

async function executeSearchWeb(args: Record<string, unknown>): Promise<ToolResult> {
  const query = String(args.query || '')

  if (!query) {
    return { success: false, error: 'Query is required' }
  }

  // SearxNG integration - requires configuration
  // For now, return a helpful message
  return {
    success: false,
    error: 'Web search is not configured. Please set up SearxNG in settings.yaml'
  }
}

async function executeDuckAi(args: Record<string, unknown>): Promise<ToolResult> {
  const query = String(args.query || '')

  if (!query) {
    return { success: false, error: 'Query is required' }
  }

  // DuckDuckGo AI integration
  // For now, return a helpful message
  return {
    success: false,
    error: 'DuckDuckGo AI is not yet implemented'
  }
}

function executeGetOpenFiles(context: ToolContext): ToolResult {
  return {
    success: true,
    result: context.openFiles
  }
}

function executeGetWorkspaceFolders(context: ToolContext): ToolResult {
  return {
    success: true,
    result: context.workspaceFolders
  }
}

async function executeUpdateMemory(args: Record<string, unknown>): Promise<ToolResult> {
  const request: MemoryUpdateRequest = {
    scope: (args.scope as 'system' | 'project') || 'system',
    action: (args.action as 'add' | 'update' | 'remove') || 'add',
    section: String(args.section || ''),
    content: String(args.content || '')
  }

  if (!request.section) {
    return { success: false, error: 'Section is required' }
  }

  // Memory updates require user confirmation
  // This will be handled by the handler layer
  return {
    success: true,
    result: {
      type: 'memory_update_proposal',
      request
    }
  }
}

/**
 * Consult a specialist agent for help with a task.
 * Routes the request through the multi-agent system.
 */
async function executeConsultAgent(
  agentType: AgentType,
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const task = String(args.task || '')
  const additionalContext = args.context ? String(args.context) : args.content ? String(args.content) : ''

  if (!task) {
    return { success: false, error: 'Task description is required' }
  }

  // Check if multi-agent system is available
  if (!isMultiAgentInitialized()) {
    // Fall back to a helpful message if multi-agent is not enabled
    return {
      success: true,
      result: `[${agentType.toUpperCase()} AGENT SIMULATION]\n\n` +
        `Task: ${task}\n` +
        `${additionalContext ? `Context: ${additionalContext}\n` : ''}` +
        `\nNote: Multi-agent system is not enabled. To enable specialist agents, ` +
        `add an "agents" section to your settings.yaml file.\n\n` +
        `For now, I'll help you directly with this ${agentType} task.`
    }
  }

  try {
    // Route the task to the specialist agent
    const agentTask = await routeUserMessage(
      `[From Orchestrator] ${task}${additionalContext ? `\n\nContext: ${additionalContext}` : ''}`,
      {
        targetAgent: agentType,
        workspaceFolders: context.workspaceFolders,
        openFiles: context.openFiles
      }
    )

    if (!agentTask) {
      return { success: false, error: `Failed to create task for ${agentType} agent` }
    }

    // Wait for the task to complete (with timeout)
    const timeout = 60000 // 60 seconds
    const startTime = Date.now()

    while (agentTask.status !== 'complete' && agentTask.status !== 'failed') {
      if (Date.now() - startTime > timeout) {
        return {
          success: false,
          error: `${agentType} agent task timed out after ${timeout / 1000} seconds`
        }
      }
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    if (agentTask.status === 'failed') {
      return {
        success: false,
        error: `${agentType} agent failed: ${agentTask.error || 'Unknown error'}`
      }
    }

    // Return the agent's result
    const result = agentTask.result
    return {
      success: true,
      result: `[${agentType.toUpperCase()} AGENT RESPONSE]\n\n${
        typeof result === 'string' ? result : JSON.stringify(result, null, 2)
      }`
    }
  } catch (error) {
    return {
      success: false,
      error: `Failed to consult ${agentType} agent: ${String(error)}`
    }
  }
}

// ============================================================================
// Thought Loop Tool Implementations
// ============================================================================

/**
 * Shows a message to the user.
 * Non-blocking - the thought loop continues after this.
 */
function executeConsultBoss(args: Record<string, unknown>): ToolResult {
  const message = String(args.message || '')
  const messageType = (args.type as string) || 'info'

  if (!message) {
    return { success: false, error: 'Message is required' }
  }

  // The message will be rendered in the UI via the uiData field
  return {
    success: true,
    result: 'Message shown to user',
    uiData: {
      type: 'consult_boss',
      message,
      messageType: messageType as 'info' | 'success' | 'warning' | 'error' | 'progress'
    }
  }
}

/**
 * Updates the task list for the current conversation.
 * Non-blocking - returns the updated task list for the prompt.
 */
async function executeUpdateTasks(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  if (!context.filebarId || !context.conversationId) {
    return { success: false, error: 'Missing filebarId or conversationId in context' }
  }

  // Load or create task list
  let taskList = await loadTaskList(context.filebarId, context.conversationId)
  if (!taskList) {
    taskList = createTaskList(context.conversationId)
  }

  // Process additions
  const toAdd = args.add as Array<{ description: string; priority?: number }> | undefined
  if (toAdd && Array.isArray(toAdd)) {
    for (const task of toAdd) {
      if (task.description) {
        addTask(taskList, task.description, task.priority || 0)
      }
    }
  }

  // Process completions
  const toComplete = args.complete as string[] | undefined
  if (toComplete && Array.isArray(toComplete)) {
    completeTasks(taskList, toComplete)
  }

  // Process removals
  const toRemove = args.remove as string[] | undefined
  if (toRemove && Array.isArray(toRemove)) {
    for (const taskId of toRemove) {
      removeTask(taskList, taskId)
    }
  }

  // Process updates
  const toUpdate = args.update as Array<{
    id: string
    status?: Task['status']
    description?: string
  }> | undefined
  if (toUpdate && Array.isArray(toUpdate)) {
    for (const update of toUpdate) {
      if (update.status) {
        updateTaskStatus(taskList, update.id, update.status)
      }
      if (update.description) {
        updateTaskDescription(taskList, update.id, update.description)
      }
    }
  }

  // Save the updated task list
  console.log('[Markus] Saving task list:', taskList.tasks.length, 'tasks')
  console.log('[Markus] Task descriptions:', taskList.tasks.map(t => `[${t.status}] ${t.description}`))
  await saveTaskList(context.filebarId, taskList)

  // Return the formatted task list for injection into the next prompt
  return {
    success: true,
    result: formatTaskListForPrompt(taskList)
  }
}

/**
 * Asks the user a question with predefined options.
 * BLOCKING - pauses the thought loop until user responds.
 */
function executeAskUser(args: Record<string, unknown>): ToolResult {
  const question = String(args.question || '')
  const options = args.options as string[] | undefined
  const reason = args.reason ? String(args.reason) : undefined

  if (!question) {
    return { success: false, error: 'Question is required' }
  }

  if (!options || !Array.isArray(options) || options.length < 2) {
    return { success: false, error: 'At least 2 options are required' }
  }

  if (options.length > 5) {
    return { success: false, error: 'Maximum 5 options allowed' }
  }

  return {
    success: true,
    result: 'WAITING_FOR_USER_INPUT',
    blocking: true,
    uiData: {
      type: 'ask_user',
      question,
      options: [...options, 'Other'],
      reason
    }
  }
}

/**
 * Requests approval when all tasks are complete.
 * BLOCKING - pauses the thought loop for user review.
 */
function executeRequestApproval(args: Record<string, unknown>): ToolResult {
  const summary = String(args.summary || '')
  const filesChanged = args.files_changed as string[] | undefined

  if (!summary) {
    return { success: false, error: 'Summary is required' }
  }

  return {
    success: true,
    result: 'WAITING_FOR_APPROVAL',
    blocking: true,
    uiData: {
      type: 'approval',
      summary,
      filesChanged: filesChanged || []
    }
  }
}
