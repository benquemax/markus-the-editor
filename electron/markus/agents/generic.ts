/**
 * Generic Agent
 *
 * An instruction-driven agent whose behavior comes from its roleDefinition
 * and customInstructions rather than a hardcoded class. Used for API-defined
 * agents created via the /agents REST endpoint.
 *
 * Unlike specialist agents (ResearchAgent, CritiqueAgent, etc.), GenericAgent
 * gets its identity and capabilities from the AgentDefinition provided at
 * creation time. Tool access is configurable via the `tools` parameter,
 * defaulting to a read-only set.
 */

import {
  AgentType,
  AgentSettings
} from './types'
import { BaseAgent } from './base'
import { ToolDefinition, ToolContext } from '../types'
import {
  TOOL_DEFINITIONS as ALL_TOOL_DEFINITIONS,
  executeTool as globalExecuteTool
} from '../tools'
import { agentEventBus } from './eventBus'
import { agentContextManager } from './contextManager'

// ============================================================================
// Tool Presets
// ============================================================================

/**
 * Named bundles of tool names for convenient agent configuration.
 * Clients can use these preset names or specify individual tool names.
 */
export const TOOL_PRESETS: Record<string, string[]> = {
  'read-only': ['read_file', 'list_directory', 'search_files'],
  'editor': ['read_file', 'list_directory', 'search_files', 'edit_file', 'create_file', 'delete_file', 'create_directory'],
  'research': ['read_file', 'list_directory', 'search_files', 'search_web', 'duck_ai'],
  'full': [
    'read_file', 'list_directory', 'search_files',
    'edit_file', 'create_file', 'delete_file', 'create_directory',
    'search_web', 'duck_ai'
  ],
}

/** Default tool set for agents that don't specify tools */
export const DEFAULT_TOOLS = TOOL_PRESETS['read-only']

/**
 * Tool names that generic agents are allowed to use.
 * Excludes orchestrator-level tools (agent delegation, thought loop control)
 * which are only available to the main thought loop.
 */
const ALLOWED_GENERIC_TOOLS = new Set([
  // File read
  'read_file', 'list_directory', 'search_files',
  // File write
  'edit_file', 'create_file', 'delete_file', 'create_directory',
  // Web
  'search_web', 'duck_ai',
  // Context
  'get_open_files', 'get_workspace_folders',
  // Memory
  'update_memory',
])

// ============================================================================
// Types
// ============================================================================

/**
 * Agent definition as stored/passed from the API.
 * Mirrors the server's AgentDefinition type without creating a dependency.
 */
export interface AgentDefinition {
  id: string
  slug: string
  name: string
  roleDefinition: string
  whenToUse: string
  description: string
  customInstructions?: string
  model: string
  endpoint: string
  apiKey?: string
  maxTokens: number
  temperature: number
  timeout?: number
  tools?: string[]
  createdAt: number
  updatedAt: number
}

// ============================================================================
// Generic Agent
// ============================================================================

/**
 * A generic, instruction-driven agent.
 * Its behavior is determined by roleDefinition and customInstructions
 * rather than a hardcoded class with fixed tool definitions.
 */
export class GenericAgent extends BaseAgent {
  // The type is the slug from the agent definition.
  // Cast to AgentType for compatibility with the existing registry/router.
  readonly type: AgentType

  /** Human-readable agent name */
  readonly agentName: string

  /** Core instructions defining this agent's identity */
  readonly roleDefinition: string

  /** Additional per-agent instructions */
  readonly customInstructions?: string

  /** Which tool names this agent is allowed to use */
  private readonly allowedTools: Set<string>

  /** Workspace folders for path validation */
  private workspaceFolders: string[] = []

  constructor(
    slug: string,
    name: string,
    roleDefinition: string,
    customInstructions: string | undefined,
    settings: AgentSettings,
    workspaceFolders: string[] = [],
    tools?: string[]
  ) {
    super(settings, agentEventBus, agentContextManager)
    // Cast slug to AgentType — the router/registry accept it as a map key
    this.type = slug as AgentType
    this.agentName = name
    this.roleDefinition = roleDefinition
    this.customInstructions = customInstructions
    this.workspaceFolders = workspaceFolders

    // Resolve allowed tools: use provided list (intersected with allowed set),
    // or fall back to defaults
    const requestedTools = tools ?? DEFAULT_TOOLS
    this.allowedTools = new Set(
      requestedTools.filter(t => ALLOWED_GENERIC_TOOLS.has(t))
    )
  }

  /**
   * Update workspace folders.
   */
  setWorkspaceFolders(folders: string[]): void {
    this.workspaceFolders = folders
  }

  /**
   * Get tool definitions for this agent.
   * Filters the global TOOL_DEFINITIONS to only include tools this agent is allowed to use.
   */
  getToolDefinitions(): ToolDefinition[] {
    return ALL_TOOL_DEFINITIONS.filter(def => this.allowedTools.has(def.name))
  }

  /**
   * Execute a tool call.
   * Validates the tool is in this agent's allowed set, then delegates
   * to the global executeTool() which already handles all tool implementations.
   */
  async executeTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{ success: boolean; result?: unknown; error?: string }> {
    if (!this.allowedTools.has(toolName)) {
      return { success: false, error: `Tool "${toolName}" is not available to this agent` }
    }

    // Build a ToolContext for the global executor
    const context: ToolContext = {
      workspaceFolders: this.workspaceFolders,
      openFiles: [],
      mainWindow: null,
    }

    const result = await globalExecuteTool(toolName, args, context)
    return {
      success: result.success,
      result: result.result,
      error: result.error,
    }
  }

  /**
   * Format a task prompt with roleDefinition and customInstructions prepended.
   */
  protected formatTaskPrompt(task: { description: string; context: Record<string, unknown> }): string {
    let prompt = ''

    // Prepend role definition
    prompt += `## Your Role\n\n${this.roleDefinition}\n\n`

    // Prepend custom instructions if present
    if (this.customInstructions) {
      prompt += `## Additional Instructions\n\n${this.customInstructions}\n\n`
    }

    // Add the task
    prompt += `## Task\n\n${task.description}\n`

    if (Object.keys(task.context).length > 0) {
      prompt += '\nContext:\n'
      for (const [key, value] of Object.entries(task.context)) {
        prompt += `- ${key}: ${JSON.stringify(value)}\n`
      }
    }

    return prompt
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Creates a GenericAgent from an agent definition's components.
 */
export function createGenericAgent(
  slug: string,
  name: string,
  roleDefinition: string,
  customInstructions: string | undefined,
  settings: AgentSettings,
  workspaceFolders: string[] = [],
  tools?: string[]
): GenericAgent {
  return new GenericAgent(slug, name, roleDefinition, customInstructions, settings, workspaceFolders, tools)
}
