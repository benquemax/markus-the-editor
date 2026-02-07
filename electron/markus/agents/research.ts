/**
 * Research Agent
 *
 * Specialized agent for finding information from files and web.
 * Uses RAG for semantic search and can read files directly.
 * Optimized for Ministral 8B or similar small models.
 */

import fs from 'fs/promises'
import {
  AgentType,
  AgentSettings,
  RelevantFile
} from './types'
import { BaseAgent } from './base'
import { ToolDefinition } from '../types'
import { validateReadPath, isFile, isDirectory } from '../security'
import { getIndexManager } from '../rag/indexManager'
import { agentEventBus } from './eventBus'
import { agentContextManager } from './contextManager'

// ============================================================================
// Types
// ============================================================================


// ============================================================================
// Research Agent
// ============================================================================

/**
 * Research agent for information retrieval.
 */
export class ResearchAgent extends BaseAgent {
  readonly type: AgentType = 'research'

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
   * Get tool definitions for the research agent.
   */
  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'vector_search',
        description: 'Semantic search across all indexed files. Returns relevant chunks.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query'
            },
            limit: {
              type: 'number',
              description: 'Maximum results (default: 5)'
            }
          },
          required: ['query']
        }
      },
      {
        name: 'read_file',
        description: 'Read the contents of a file.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Path to the file'
            },
            startLine: {
              type: 'number',
              description: 'Start line (1-indexed, optional)'
            },
            endLine: {
              type: 'number',
              description: 'End line (optional)'
            }
          },
          required: ['path']
        }
      },
      {
        name: 'list_directory',
        description: 'List files and directories in a path.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Directory path'
            },
            recursive: {
              type: 'boolean',
              description: 'List recursively (default: false)'
            }
          },
          required: ['path']
        }
      },
      {
        name: 'search_files',
        description: 'Text search for patterns in files.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Text to search for'
            },
            path: {
              type: 'string',
              description: 'Directory to search in'
            },
            pattern: {
              type: 'string',
              description: 'File glob pattern (e.g., "*.md")'
            }
          },
          required: ['query']
        }
      },
      {
        name: 'search_web',
        description: 'Search the web for information.',
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
      case 'vector_search':
        return this.executeVectorSearch(args)
      case 'read_file':
        return this.executeReadFile(args)
      case 'list_directory':
        return this.executeListDirectory(args)
      case 'search_files':
        return this.executeSearchFiles(args)
      case 'search_web':
        return this.executeSearchWeb(args)
      default:
        return { success: false, error: `Unknown tool: ${toolName}` }
    }
  }

  /**
   * Execute vector search using RAG.
   */
  private async executeVectorSearch(
    args: Record<string, unknown>
  ): Promise<{ success: boolean; result?: unknown; error?: string }> {
    const query = String(args.query || '')
    const limit = Number(args.limit) || 5

    if (!query) {
      return { success: false, error: 'Query is required' }
    }

    try {
      const indexManager = getIndexManager()
      const results = await indexManager.search(query, limit)

      // Convert to relevant files and emit RAG event
      const relevantFiles: RelevantFile[] = results.map(r => ({
        path: r.document.filePath,
        reason: `Matched query: "${query}"`,
        score: r.score,
        snippets: [{
          startLine: r.document.metadata.startLine,
          endLine: r.document.metadata.endLine,
          content: r.document.content,
          headingContext: r.document.metadata.headingContext.join(' > ')
        }]
      }))

      this.eventBus.emit('rag:query', { query, results: relevantFiles })

      // Add to context manager
      this.contextManager.addRelevantFiles(this.type, relevantFiles)

      return {
        success: true,
        result: {
          query,
          results: results.map(r => ({
            file: r.document.filePath,
            score: r.score.toFixed(3),
            section: r.document.metadata.sectionTitle,
            lines: `${r.document.metadata.startLine}-${r.document.metadata.endLine}`,
            preview: r.document.content.slice(0, 200)
          }))
        }
      }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  /**
   * Execute read file.
   */
  private async executeReadFile(
    args: Record<string, unknown>
  ): Promise<{ success: boolean; result?: unknown; error?: string }> {
    const filePath = String(args.path || '')
    const startLine = args.startLine ? Number(args.startLine) : undefined
    const endLine = args.endLine ? Number(args.endLine) : undefined

    if (!filePath) {
      return { success: false, error: 'Path is required' }
    }

    try {
      const validatedPath = validateReadPath(filePath, this.workspaceFolders)
      if (!isFile(validatedPath)) {
        return { success: false, error: `File not found: ${filePath}` }
      }

      let content = await fs.readFile(validatedPath, 'utf-8')

      // Extract line range if specified
      if (startLine !== undefined) {
        const lines = content.split('\n')
        const start = Math.max(0, startLine - 1)
        const end = endLine ? Math.min(lines.length, endLine) : lines.length
        content = lines.slice(start, end).join('\n')
      }

      // Truncate very long content
      const MAX_LENGTH = 5000
      if (content.length > MAX_LENGTH) {
        content = content.slice(0, MAX_LENGTH) + '\n... [truncated]'
      }

      return { success: true, result: content }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  /**
   * Execute list directory.
   */
  private async executeListDirectory(
    args: Record<string, unknown>
  ): Promise<{ success: boolean; result?: unknown; error?: string }> {
    const dirPath = String(args.path || '')
    const recursive = Boolean(args.recursive)

    if (!dirPath) {
      return { success: false, error: 'Path is required' }
    }

    try {
      const validatedPath = validateReadPath(dirPath, this.workspaceFolders)
      if (!isDirectory(validatedPath)) {
        return { success: false, error: `Directory not found: ${dirPath}` }
      }

      const entries = await this.listDir(validatedPath, recursive)
      return { success: true, result: entries }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  /**
   * List directory contents.
   */
  private async listDir(
    dir: string,
    recursive: boolean,
    depth: number = 0
  ): Promise<Array<{ name: string; type: 'file' | 'directory'; path: string }>> {
    const MAX_DEPTH = 3
    const MAX_ENTRIES = 100

    const entries: Array<{ name: string; type: 'file' | 'directory'; path: string }> = []
    const dirEntries = await fs.readdir(dir, { withFileTypes: true })

    for (const entry of dirEntries) {
      if (entries.length >= MAX_ENTRIES) break

      // Skip hidden and common ignore patterns
      if (entry.name.startsWith('.') || entry.name === 'node_modules') {
        continue
      }

      const fullPath = `${dir}/${entry.name}`

      if (entry.isDirectory()) {
        entries.push({
          name: entry.name,
          type: 'directory',
          path: fullPath
        })

        if (recursive && depth < MAX_DEPTH) {
          const subEntries = await this.listDir(fullPath, true, depth + 1)
          entries.push(...subEntries.slice(0, MAX_ENTRIES - entries.length))
        }
      } else {
        entries.push({
          name: entry.name,
          type: 'file',
          path: fullPath
        })
      }
    }

    return entries
  }

  /**
   * Execute text search in files.
   */
  private async executeSearchFiles(
    args: Record<string, unknown>
  ): Promise<{ success: boolean; result?: unknown; error?: string }> {
    const query = String(args.query || '')
    const searchPath = args.path
      ? String(args.path)
      : this.workspaceFolders[0]
    const pattern = args.pattern ? String(args.pattern) : '*'

    if (!query) {
      return { success: false, error: 'Query is required' }
    }

    if (!searchPath) {
      return { success: false, error: 'No workspace folder available' }
    }

    try {
      const validatedPath = validateReadPath(searchPath, this.workspaceFolders)
      const results = await this.searchInDir(validatedPath, query, pattern)

      return { success: true, result: results }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  /**
   * Search in directory.
   */
  private async searchInDir(
    dir: string,
    query: string,
    pattern: string
  ): Promise<Array<{ file: string; line: number; content: string }>> {
    const MAX_RESULTS = 50
    const results: Array<{ file: string; line: number; content: string }> = []
    const queryLower = query.toLowerCase()

    const search = async (currentDir: string) => {
      if (results.length >= MAX_RESULTS) return

      const entries = await fs.readdir(currentDir, { withFileTypes: true })

      for (const entry of entries) {
        if (results.length >= MAX_RESULTS) return

        if (entry.name.startsWith('.') || entry.name === 'node_modules') {
          continue
        }

        const fullPath = `${currentDir}/${entry.name}`

        if (entry.isDirectory()) {
          await search(fullPath)
        } else if (this.matchesPattern(entry.name, pattern)) {
          try {
            const content = await fs.readFile(fullPath, 'utf-8')
            const lines = content.split('\n')

            for (let i = 0; i < lines.length && results.length < MAX_RESULTS; i++) {
              if (lines[i].toLowerCase().includes(queryLower)) {
                results.push({
                  file: fullPath,
                  line: i + 1,
                  content: lines[i].trim().slice(0, 200)
                })
              }
            }
          } catch {
            // Skip files we can't read
          }
        }
      }
    }

    await search(dir)
    return results
  }

  /**
   * Match filename against glob pattern.
   */
  private matchesPattern(filename: string, pattern: string): boolean {
    if (pattern === '*') return true
    const regex = new RegExp(
      '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$',
      'i'
    )
    return regex.test(filename)
  }

  /**
   * Execute web search (placeholder).
   */
  private async executeSearchWeb(
    args: Record<string, unknown>
  ): Promise<{ success: boolean; result?: unknown; error?: string }> {
    const query = String(args.query || '')

    if (!query) {
      return { success: false, error: 'Query is required' }
    }

    // TODO: Implement actual web search integration
    return {
      success: false,
      error: 'Web search not yet implemented'
    }
  }
}

/**
 * Create a research agent with the given settings.
 */
export function createResearchAgent(
  settings: AgentSettings,
  workspaceFolders: string[] = []
): ResearchAgent {
  const agent = new ResearchAgent(settings, workspaceFolders)
  agent.initialize()
  return agent
}
