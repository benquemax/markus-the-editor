/**
 * Markus Tools System
 *
 * Defines all available tools for the AI agent and their execution logic.
 * Tools are sandboxed to only operate within workspace directories.
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
  routeUserMessage,
  searchRAG
} from './multiAgent'
import { AgentType, AgentTask } from './agents/types'
import { GenericAgent } from './agents/generic'
import { v4 as uuidv4 } from 'uuid'
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
    name: 'vector_search',
    description: 'Semantic search across indexed workspace files. Returns relevant chunks with similarity scores. Requires RAG indexing to be enabled.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language search query'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 5)'
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
    description: 'Get the list of workspace folders currently open in the workspace.',
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
          description: 'Tasks to add, e.g. [{"description": "Do something", "priority": 5}]. Priority is optional (higher = more important).'
        },
        complete: {
          type: 'array',
          description: 'Task IDs to mark as done, e.g. ["t1", "t3"]. Use IDs shown in parentheses in the task list.'
        },
        remove: {
          type: 'array',
          description: 'Task IDs to remove, e.g. ["t2"]. Use IDs shown in parentheses in the task list.'
        },
        update: {
          type: 'array',
          description: 'Tasks to update, e.g. [{"id": "t1", "status": "in_progress"}]. Status can be "pending", "in_progress", "blocked", or "done". Description is also updatable.'
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
      case 'vector_search':
        return await executeVectorSearch(args, context)
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

async function executeVectorSearch(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const query = String(args.query || '')
  const limit = typeof args.limit === 'number' ? args.limit : 5

  if (!query) {
    return { success: false, error: 'Query is required' }
  }

  // Use conversationId from context if available for per-conversation index
  const conversationId = context.conversationId as string | undefined

  const results = await searchRAG(query, limit, conversationId)

  if (results.length === 0) {
    return {
      success: true,
      result: 'No results found. The RAG index may not be initialized or no documents matched your query.'
    }
  }

  const formatted = results.map((r, i) =>
    `[${i + 1}] ${r.filePath} (lines ${r.startLine}-${r.endLine}, score: ${r.score.toFixed(2)})\n${r.content}`
  ).join('\n\n')

  return { success: true, result: formatted }
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
  if (!context.workspaceId || !context.conversationId) {
    return { success: false, error: 'Missing workspaceId or conversationId in context' }
  }

  // Load or create task list
  let taskList = await loadTaskList(context.workspaceId, context.conversationId)
  if (!taskList) {
    taskList = createTaskList(context.conversationId)
  }

  // Track warnings for failed operations so the LLM gets feedback
  const warnings: string[] = []

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
    const completedCount = completeTasks(taskList, toComplete)
    if (completedCount < toComplete.length) {
      const validIds = taskList.tasks.map(t => t.id)
      const invalidIds = toComplete.filter(id => !validIds.includes(id))
      if (invalidIds.length > 0) {
        warnings.push(`Could not complete: ${invalidIds.join(', ')} (not found). Valid IDs: ${validIds.join(', ')}`)
      }
    }
  }

  // Process removals
  const toRemove = args.remove as string[] | undefined
  if (toRemove && Array.isArray(toRemove)) {
    for (const taskId of toRemove) {
      const removed = removeTask(taskList, taskId)
      if (!removed) {
        const validIds = taskList.tasks.map(t => t.id)
        warnings.push(`Could not remove "${taskId}" (not found). Valid IDs: ${validIds.join(', ')}`)
      }
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
      let found = false
      if (update.status) {
        found = updateTaskStatus(taskList, update.id, update.status) || found
      }
      if (update.description) {
        found = updateTaskDescription(taskList, update.id, update.description) || found
      }
      if (!found) {
        const validIds = taskList.tasks.map(t => t.id)
        warnings.push(`Could not update "${update.id}" (not found). Valid IDs: ${validIds.join(', ')}`)
      }
    }
  }

  // Save the updated task list
  console.log('[Markus] Saving task list:', taskList.tasks.length, 'tasks')
  console.log('[Markus] Task descriptions:', taskList.tasks.map(t => `[${t.status}] ${t.description}`))
  await saveTaskList(context.workspaceId, taskList)

  // Return the formatted task list, with warnings appended so the LLM sees errors
  let result = formatTaskListForPrompt(taskList)
  if (warnings.length > 0) {
    result += '\n\n⚠️ Warnings:\n' + warnings.map(w => `- ${w}`).join('\n')
  }

  // Nudge the agent away from creating more tasks when the list is already large
  const openCount = taskList.tasks.filter(t => t.status !== 'done').length
  if (openCount > 10) {
    result += `\n\n⚠️ Task list has ${openCount} open items — stop adding tasks and focus on completing existing ones.`
  }

  return {
    success: true,
    result
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

// ============================================================================
// Orchestrator Tool Builder
// ============================================================================

/**
 * Thought loop control tools that the orchestrator always has access to.
 * These are a subset of TOOL_DEFINITIONS — the orchestrator communicates
 * with the user and manages tasks, but does NOT directly touch files.
 */
const ORCHESTRATOR_CONTROL_TOOL_NAMES = [
  'consult_boss',
  'update_tasks',
  'ask_user',
  'request_task_approval'
]

/**
 * Builds the orchestrator's tool set and custom executor.
 *
 * When sub-agents are defined, the orchestrator gets:
 * 1. Thought loop control tools (consult_boss, update_tasks, etc.)
 * 2. One `consult_<slug>_agent` tool per sub-agent (generated dynamically)
 *
 * The orchestrator does NOT get direct file tools — it delegates to sub-agents.
 * This prevents context pollution: only text summaries from sub-agents enter
 * the orchestrator's context window.
 */
export function buildOrchestratorTools(
  subAgents: GenericAgent[]
): {
  definitions: ToolDefinition[]
  executeTool: (name: string, args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>
} {
  // 1. Collect thought loop control tool definitions from the global set
  const controlTools = TOOL_DEFINITIONS.filter(
    def => ORCHESTRATOR_CONTROL_TOOL_NAMES.includes(def.name)
  )

  // 2. Generate a consult_<slug>_agent tool per sub-agent
  const agentTools: ToolDefinition[] = subAgents.map(agent => ({
    name: `consult_${agent.type}_agent`,
    description: `Delegate a task to the ${agent.agentName} agent. ${agent.roleDefinition.substring(0, 200)}`,
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: `Task description for the ${agent.agentName} agent. Include ALL relevant context — the agent cannot see your conversation history.`
        },
        context: {
          type: 'string',
          description: 'Additional context about what you are working on'
        }
      },
      required: ['task']
    }
  }))

  const definitions = [...controlTools, ...agentTools]

  // 3. Build a slug → agent lookup for fast dispatch
  const agentBySlug = new Map<string, GenericAgent>()
  for (const agent of subAgents) {
    agentBySlug.set(String(agent.type), agent)
  }

  // 4. Custom executor that routes to sub-agents or global executeTool
  const orchestratorExecuteTool = async (
    name: string,
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> => {
    // Thought loop control tools → delegate to global executeTool
    if (ORCHESTRATOR_CONTROL_TOOL_NAMES.includes(name)) {
      return executeTool(name, args, ctx)
    }

    // consult_<slug>_agent → dispatch to sub-agent
    const agentMatch = name.match(/^consult_(.+)_agent$/)
    if (agentMatch) {
      const slug = agentMatch[1]
      const agent = agentBySlug.get(slug)
      if (!agent) {
        return { success: false, error: `Unknown agent: ${slug}` }
      }

      return executeSubAgentTask(agent, args, ctx)
    }

    return { success: false, error: `Unknown orchestrator tool: ${name}` }
  }

  return { definitions, executeTool: orchestratorExecuteTool }
}

/**
 * Runs a sub-agent task and returns a text summary for the orchestrator.
 *
 * Creates an AgentTask, calls processTask() which runs one LLM round
 * with the sub-agent's own tools in its own context. Only the text
 * result is returned to the orchestrator — no file contents or tool
 * call details leak into the orchestrator's context.
 */
async function executeSubAgentTask(
  agent: GenericAgent,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> {
  const taskDescription = String(args.task || '')
  const additionalContext = args.context ? String(args.context) : ''

  if (!taskDescription) {
    return { success: false, error: 'Task description is required' }
  }

  // Ensure agent is initialized (creates LLM client if needed)
  if (!agent.getStatus || agent.getStatus() === 'idle') {
    try {
      agent.initialize()
    } catch {
      // Already initialized, continue
    }
  }

  // Update workspace folders so path validation works
  agent.setWorkspaceFolders(ctx.workspaceFolders)

  // Build the agent task
  const agentTask: AgentTask = {
    id: uuidv4(),
    description: taskDescription + (additionalContext ? `\n\nContext: ${additionalContext}` : ''),
    agent: agent.type,
    priority: 1,
    status: 'pending',
    context: {
      workspaceFolders: ctx.workspaceFolders,
      openFiles: ctx.openFiles
    },
    createdAt: Date.now()
  }

  try {
    // processTask runs one LLM round with the agent's own tools
    await agent.processTask(agentTask)

    if (agentTask.status === 'failed') {
      return {
        success: false,
        error: `${agent.agentName} agent failed: ${agentTask.error || 'Unknown error'}`
      }
    }

    // Extract text result — only the summary enters orchestrator context
    const result = agentTask.result
    const resultText = typeof result === 'string'
      ? result
      : (result as { content?: string })?.content || JSON.stringify(result, null, 2)

    return {
      success: true,
      result: `[${agent.agentName.toUpperCase()} AGENT RESPONSE]\n\n${resultText}`
    }
  } catch (error) {
    return {
      success: false,
      error: `Failed to consult ${agent.agentName} agent: ${String(error)}`
    }
  }
}
