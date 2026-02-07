/**
 * Editor Agent
 *
 * Specialized agent for file creation and modification using SEARCH/REPLACE blocks.
 * Uses fuzzy matching to handle small model output variations.
 * Optimized for Ministral 8B or similar small models.
 */

import fs from 'fs/promises'
import { existsSync } from 'fs'
import {
  AgentType,
  AgentSettings,
  SearchReplaceEdit,
  EditResult
} from '../types'
import { BaseAgent } from '../base'
import { ToolDefinition } from '../../types'
import { validateEdit, applyEdit } from './validator'
import { validateReadPath, isFile } from '../../security'
import { agentEventBus } from '../eventBus'
import { agentContextManager } from '../contextManager'

// ============================================================================
// Edit Parsing
// ============================================================================

/**
 * Parse SEARCH/REPLACE blocks from LLM output.
 *
 * Expected format:
 * <edit>
 * <file>path/to/file.md</file>
 * <search>
 * text to find
 * </search>
 * <replace>
 * new text
 * </replace>
 * </edit>
 */
export function parseEdits(content: string): SearchReplaceEdit[] {
  const edits: SearchReplaceEdit[] = []

  // Match <edit>...</edit> blocks
  const editBlockRegex = /<edit>([\s\S]*?)<\/edit>/g
  let match

  while ((match = editBlockRegex.exec(content)) !== null) {
    const block = match[1]

    // Extract file path
    const fileMatch = block.match(/<file>([\s\S]*?)<\/file>/)
    if (!fileMatch) continue

    // Extract search text
    const searchMatch = block.match(/<search>([\s\S]*?)<\/search>/)
    const search = searchMatch ? searchMatch[1].trim() : ''

    // Extract replace text
    const replaceMatch = block.match(/<replace>([\s\S]*?)<\/replace>/)
    const replace = replaceMatch ? replaceMatch[1].trim() : ''

    edits.push({
      file: fileMatch[1].trim(),
      search,
      replace
    })
  }

  return edits
}

// ============================================================================
// Editor Agent
// ============================================================================

/**
 * Editor agent for file modifications.
 */
export class EditorAgent extends BaseAgent {
  readonly type: AgentType = 'editor'

  /** Workspace folders for path validation */
  private workspaceFolders: string[] = []

  constructor(
    settings: AgentSettings,
    workspaceFolders: string[] = []
  ) {
    super(settings, agentEventBus, agentContextManager)
    this.workspaceFolders = workspaceFolders
  }

  /**
   * Update workspace folders.
   */
  setWorkspaceFolders(folders: string[]): void {
    this.workspaceFolders = folders
  }

  /**
   * Get tool definitions for the editor agent.
   */
  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'read_file',
        description: 'Read the contents of a file before editing it.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Path to the file to read'
            }
          },
          required: ['path']
        }
      },
      {
        name: 'edit_file',
        description: 'Edit a file using SEARCH/REPLACE. The search text must exist in the file.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Path to the file to edit'
            },
            search: {
              type: 'string',
              description: 'Text to find (include context for uniqueness)'
            },
            replace: {
              type: 'string',
              description: 'Text to replace with'
            }
          },
          required: ['path', 'search', 'replace']
        }
      },
      {
        name: 'create_file',
        description: 'Create a new file with the given content.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Path for the new file'
            },
            content: {
              type: 'string',
              description: 'Content to write'
            }
          },
          required: ['path', 'content']
        }
      }
    ]
  }

  /**
   * Execute a tool call.
   */
  async executeTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{ success: boolean; result?: unknown; error?: string }> {
    switch (toolName) {
      case 'read_file':
        return this.executeReadFile(args)
      case 'edit_file':
        return this.executeEditFile(args)
      case 'create_file':
        return this.executeCreateFile(args)
      default:
        return { success: false, error: `Unknown tool: ${toolName}` }
    }
  }

  /**
   * Execute read_file tool.
   */
  private async executeReadFile(
    args: Record<string, unknown>
  ): Promise<{ success: boolean; result?: unknown; error?: string }> {
    const filePath = String(args.path || '')
    if (!filePath) {
      return { success: false, error: 'Path is required' }
    }

    try {
      const validatedPath = validateReadPath(filePath, this.workspaceFolders)
      if (!isFile(validatedPath)) {
        return { success: false, error: `File not found: ${filePath}` }
      }

      const content = await fs.readFile(validatedPath, 'utf-8')
      return { success: true, result: content }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  /**
   * Execute edit_file tool.
   */
  private async executeEditFile(
    args: Record<string, unknown>
  ): Promise<{ success: boolean; result?: unknown; error?: string }> {
    const edit: SearchReplaceEdit = {
      file: String(args.path || ''),
      search: String(args.search || ''),
      replace: String(args.replace || '')
    }

    if (!edit.file) {
      return { success: false, error: 'Path is required' }
    }

    // Validate the edit
    const validation = await validateEdit(edit, {
      workspaceFolders: this.workspaceFolders,
      allowCreate: false
    })

    if (!validation.valid) {
      return { success: false, error: validation.error }
    }

    // Emit edit proposed event
    this.eventBus.emit('edit:proposed', {
      edit,
      taskId: this.currentTask?.id || ''
    })

    // Apply the edit
    const result = await applyEdit(edit, validation)

    // Emit edit applied event
    this.eventBus.emit('edit:applied', { edit, result })

    if (!result.success) {
      return { success: false, error: result.error }
    }

    return {
      success: true,
      result: {
        message: `File edited successfully: ${edit.file}`,
        lineNumber: result.lineNumber,
        strategy: result.matchStrategy,
        similarity: result.similarity
      }
    }
  }

  /**
   * Execute create_file tool.
   */
  private async executeCreateFile(
    args: Record<string, unknown>
  ): Promise<{ success: boolean; result?: unknown; error?: string }> {
    const filePath = String(args.path || '')
    const content = String(args.content || '')

    if (!filePath) {
      return { success: false, error: 'Path is required' }
    }

    const edit: SearchReplaceEdit = {
      file: filePath,
      search: '',  // Empty search for new file
      replace: content
    }

    const validation = await validateEdit(edit, {
      workspaceFolders: this.workspaceFolders,
      allowCreate: true
    })

    if (!validation.valid) {
      return { success: false, error: validation.error }
    }

    // Check if file already exists
    if (existsSync(filePath)) {
      return { success: false, error: `File already exists: ${filePath}` }
    }

    // Create the file
    try {
      await fs.writeFile(filePath, content, 'utf-8')
    } catch (error) {
      return { success: false, error: `Failed to create file: ${error}` }
    }

    return {
      success: true,
      result: `File created successfully: ${filePath}`
    }
  }

  /**
   * Process edits from LLM response.
   * Parses SEARCH/REPLACE blocks and applies them.
   */
  async processEditsFromResponse(
    response: string
  ): Promise<{ edits: EditResult[]; errors: string[] }> {
    const edits = parseEdits(response)
    const results: EditResult[] = []
    const errors: string[] = []

    for (const edit of edits) {
      const validation = await validateEdit(edit, {
        workspaceFolders: this.workspaceFolders,
        allowCreate: true
      })

      if (!validation.valid) {
        errors.push(`${edit.file}: ${validation.error}`)
        results.push({
          success: false,
          error: validation.error
        })
        continue
      }

      // Emit proposed event
      this.eventBus.emit('edit:proposed', {
        edit,
        taskId: this.currentTask?.id || ''
      })

      const result = await applyEdit(edit, validation)
      results.push(result)

      // Emit applied event
      this.eventBus.emit('edit:applied', { edit, result })

      if (!result.success) {
        errors.push(`${edit.file}: ${result.error}`)
      }
    }

    return { edits: results, errors }
  }
}

/**
 * Create an editor agent with the given settings.
 */
export function createEditorAgent(
  settings: AgentSettings,
  workspaceFolders: string[] = []
): EditorAgent {
  const agent = new EditorAgent(settings, workspaceFolders)
  agent.initialize()
  return agent
}
