/**
 * Style Agent
 *
 * Specialized agent for checking voice, tone, and formatting consistency.
 * Ensures documents maintain consistent style throughout.
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
 * Style issue identified by the agent.
 */
export interface StyleIssue {
  location: string
  issue: string
  fix: string
}

/**
 * Parse style issues from agent response.
 */
export function parseStyleIssues(content: string): StyleIssue[] {
  const issues: StyleIssue[] = []
  const regex = /<style_issue>([\s\S]*?)<\/style_issue>/g

  let match
  while ((match = regex.exec(content)) !== null) {
    const block = match[1]

    const locationMatch = block.match(/<location>([\s\S]*?)<\/location>/)
    const issueMatch = block.match(/<issue>([\s\S]*?)<\/issue>/)
    const fixMatch = block.match(/<fix>([\s\S]*?)<\/fix>/)

    if (locationMatch && issueMatch && fixMatch) {
      issues.push({
        location: locationMatch[1].trim(),
        issue: issueMatch[1].trim(),
        fix: fixMatch[1].trim()
      })
    }
  }

  return issues
}

// ============================================================================
// Style Agent
// ============================================================================

/**
 * Style agent for formatting and tone consistency.
 */
export class StyleAgent extends BaseAgent {
  readonly type: AgentType = 'style'

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
   * Get tool definitions for the style agent.
   */
  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'read_file',
        description: 'Read a file to analyze its style.',
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
      const MAX_LENGTH = 6000
      if (content.length > MAX_LENGTH) {
        content = content.slice(0, MAX_LENGTH) + '\n... [truncated]'
      }

      return { success: true, result: content }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  /**
   * Analyze content for style consistency.
   */
  async analyzeStyle(
    content: string,
    styleGuide?: string
  ): Promise<{ issues: StyleIssue[]; summary: string }> {
    if (!this.llmClient) {
      throw new Error('Agent not initialized')
    }

    // Build style analysis prompt
    const prompt = `Analyze the following content for style consistency:

${content}

${styleGuide ? `\nStyle Guide:\n${styleGuide}` : ''}

Check for:
1. Consistent voice (formal/informal)
2. Appropriate tone
3. Heading hierarchy
4. List formatting
5. Link validity

Report issues using this format:
<style_issue>
<location>where in document</location>
<issue>what's wrong</issue>
<fix>suggested correction</fix>
</style_issue>`

    // Add to context
    this.contextManager.addMessage(this.type, {
      role: 'user',
      content: prompt
    })

    // Get LLM response
    const messages = this.contextManager.getMessagesForLLM(this.type)
    const response = await this.llmClient.chat(messages)

    // Parse issues
    const issues = parseStyleIssues(response.content)

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
 * Create a style agent with the given settings.
 */
export function createStyleAgent(
  settings: AgentSettings,
  workspaceFolders: string[] = []
): StyleAgent {
  const agent = new StyleAgent(settings, workspaceFolders)
  agent.initialize()
  return agent
}
