/**
 * Critique Agent
 *
 * Specialized agent for reviewing content quality and consistency.
 * Identifies issues and suggests improvements.
 * Optimized for Ministral 8B or similar small models.
 */

import fs from 'fs/promises'
import {
  AgentType,
  AgentSettings
} from './types'
import { BaseAgent } from './base'
import { ToolDefinition } from '../types'
import { validateReadPath, isFile } from '../security'
import { agentEventBus } from './eventBus'
import { agentContextManager } from './contextManager'

// ============================================================================
// Types
// ============================================================================

/**
 * Parsed review issue from critique agent output.
 */
export interface ReviewIssue {
  severity: 'high' | 'medium' | 'low'
  description: string
  suggestion?: string
  location?: string
}

/**
 * Parse review issues from critique agent response.
 */
export function parseReviewIssues(content: string): ReviewIssue[] {
  const issues: ReviewIssue[] = []
  const reviewRegex = /<review>([\s\S]*?)<\/review>/g

  let match
  while ((match = reviewRegex.exec(content)) !== null) {
    const block = match[1]

    // Parse issues
    const issueRegex = /<issue\s+severity="([^"]+)">([\s\S]*?)<\/issue>/g
    let issueMatch

    while ((issueMatch = issueRegex.exec(block)) !== null) {
      const severity = issueMatch[1] as 'high' | 'medium' | 'low'
      const description = issueMatch[2].trim()

      // Look for associated suggestion
      const suggestionMatch = block.match(/<suggestion>([\s\S]*?)<\/suggestion>/)
      const suggestion = suggestionMatch ? suggestionMatch[1].trim() : undefined

      issues.push({ severity, description, suggestion })
    }
  }

  return issues
}

// ============================================================================
// Critique Agent
// ============================================================================

/**
 * Critique agent for content review.
 */
export class CritiqueAgent extends BaseAgent {
  readonly type: AgentType = 'critique'

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
   * Get tool definitions for the critique agent.
   */
  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'read_file',
        description: 'Read a file to review its contents.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Path to the file'
            }
          },
          required: ['path']
        }
      },
      {
        name: 'list_directory',
        description: 'List files in a directory to find related content.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Directory path'
            }
          },
          required: ['path']
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
      case 'list_directory':
        return this.executeListDirectory(args)
      default:
        return { success: false, error: `Unknown tool: ${toolName}` }
    }
  }

  /**
   * Execute read file.
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

      let content = await fs.readFile(validatedPath, 'utf-8')

      // Truncate very long content
      const MAX_LENGTH = 8000
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

    if (!dirPath) {
      return { success: false, error: 'Path is required' }
    }

    try {
      const validatedPath = validateReadPath(dirPath, this.workspaceFolders)
      const entries = await fs.readdir(validatedPath, { withFileTypes: true })

      const result = entries
        .filter(e => !e.name.startsWith('.'))
        .map(e => ({
          name: e.name,
          type: e.isDirectory() ? 'directory' : 'file'
        }))

      return { success: true, result }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  /**
   * Review content and return issues.
   */
  async reviewContent(
    content: string,
    context?: string
  ): Promise<{ issues: ReviewIssue[]; summary: string }> {
    if (!this.llmClient) {
      throw new Error('Agent not initialized')
    }

    // Build review prompt
    const prompt = `Review the following content for quality issues:

${content}

${context ? `\nContext: ${context}` : ''}

Analyze for:
1. Factual accuracy
2. Logical flow
3. Completeness
4. Clarity
5. Contradictions

Provide your review using this format:
<review>
<issue severity="high|medium|low">
Description of issue
</issue>
<suggestion>
How to fix it
</suggestion>
</review>`

    // Add to context
    this.contextManager.addMessage(this.type, {
      role: 'user',
      content: prompt
    })

    // Get LLM response
    const messages = this.contextManager.getMessagesForLLM(this.type)
    const response = await this.llmClient.chat(messages)

    // Parse issues
    const issues = parseReviewIssues(response.content)

    // Add response to context
    this.contextManager.addMessage(this.type, {
      role: 'assistant',
      content: response.content
    })

    return {
      issues,
      summary: response.content
    }
  }
}

/**
 * Create a critique agent with the given settings.
 */
export function createCritiqueAgent(
  settings: AgentSettings,
  workspaceFolders: string[] = []
): CritiqueAgent {
  const agent = new CritiqueAgent(settings, workspaceFolders)
  agent.initialize()
  return agent
}
