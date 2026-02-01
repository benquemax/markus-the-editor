/**
 * Markus Tools System
 *
 * Defines all available tools for the AI agent and their execution logic.
 * Tools are sandboxed to only operate within filebar workspace directories.
 */

import fs from 'fs/promises'
import path from 'path'
import { existsSync } from 'fs'
import { ToolDefinition, ToolResult, ToolContext, MemoryUpdateRequest } from './types'
import {
  validateReadPath,
  validateWritePath,
  validateDirectoryPath,
  validateEditOperation,
  isFile,
  isDirectory,
  PathSecurityError
} from './security'

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
  return { success: true, result: truncateResult(content) }
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
