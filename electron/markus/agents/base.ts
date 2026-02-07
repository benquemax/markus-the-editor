/**
 * Base Agent Class
 *
 * Abstract base class for all agents in the multi-agent system.
 * Provides common functionality for LLM communication, tool execution,
 * and event handling. Each specialized agent extends this class.
 */

import { v4 as uuidv4 } from 'uuid'
import {
  AgentType,
  AgentStatus,
  AgentSettings,
  AgentTask,
  AgentMessage,
  AgentMessageType
} from './types'
import { AgentEventBus, agentEventBus } from './eventBus'
import { AgentContextManager, agentContextManager } from './contextManager'
import { LLMClient, createLLMClient } from '../llm'
import { LLMSettings, ToolDefinition } from '../types'

// ============================================================================
// Base Agent
// ============================================================================

/**
 * Abstract base class for agents.
 * Provides common infrastructure for all agent types.
 */
export abstract class BaseAgent {
  /** Agent type identifier */
  abstract readonly type: AgentType

  /** Current agent status */
  protected status: AgentStatus = 'idle'

  /** LLM client for this agent */
  protected llmClient: LLMClient | null = null

  /** Agent settings */
  protected settings: AgentSettings

  /** Event bus for inter-agent communication */
  protected eventBus: AgentEventBus

  /** Context manager for this agent */
  protected contextManager: AgentContextManager

  /** Current task being processed */
  protected currentTask: AgentTask | null = null

  /** Abort controller for cancellation */
  protected abortController: AbortController | null = null

  constructor(
    settings: AgentSettings,
    eventBus: AgentEventBus = agentEventBus,
    contextManager: AgentContextManager = agentContextManager
  ) {
    this.settings = settings
    this.eventBus = eventBus
    this.contextManager = contextManager
  }

  /**
   * Initialize the agent with LLM client.
   */
  initialize(): void {
    const llmSettings: LLMSettings = {
      apiEndpoint: this.settings.endpoint,
      apiKey: this.settings.apiKey || '',
      model: this.settings.model,
      maxTokens: this.settings.maxTokens,
      temperature: this.settings.temperature
    }

    this.llmClient = createLLMClient(llmSettings)
    this.setStatus('idle')
  }

  /**
   * Get the current status.
   */
  getStatus(): AgentStatus {
    return this.status
  }

  /**
   * Set status and emit event.
   */
  protected setStatus(status: AgentStatus, details?: string): void {
    this.status = status
    this.eventBus.emit('agent:status', {
      agent: this.type,
      status,
      details
    })
  }

  /**
   * Get tool definitions available to this agent.
   */
  abstract getToolDefinitions(): ToolDefinition[]

  /**
   * Execute a tool call.
   */
  abstract executeTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{ success: boolean; result?: unknown; error?: string }>

  /**
   * Process a task assigned to this agent.
   */
  async processTask(task: AgentTask): Promise<void> {
    if (!this.llmClient) {
      throw new Error(`Agent ${this.type} not initialized`)
    }

    this.currentTask = task
    this.abortController = new AbortController()
    this.setStatus('thinking')

    try {
      // Update task status
      task.status = 'in_progress'
      this.eventBus.emit('task:updated', { task })

      // Add task to context
      this.contextManager.addMessage(this.type, {
        role: 'user',
        content: this.formatTaskPrompt(task)
      })

      // Get LLM response
      const messages = this.contextManager.getMessagesForLLM(this.type)
      const tools = this.getToolDefinitions()

      const response = await this.llmClient.chat(
        messages,
        tools,
        this.abortController.signal
      )

      // Process response
      const result = await this.processResponse(response, task)

      // Update task with result
      task.status = 'complete'
      task.result = result
      task.completedAt = Date.now()
      this.eventBus.emit('task:completed', { task })

      // Add response to context
      this.contextManager.addMessage(this.type, {
        role: 'assistant',
        content: response.content
      })

    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        task.status = 'cancelled'
      } else {
        task.status = 'failed'
        task.error = String(error)
        this.eventBus.emit('error', {
          agent: this.type,
          error: String(error),
          taskId: task.id
        })
      }
      this.eventBus.emit('task:updated', { task })
    } finally {
      this.currentTask = null
      this.abortController = null
      this.setStatus('idle')
    }
  }

  /**
   * Cancel the current task.
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort()
    }
  }

  /**
   * Send a message to another agent.
   */
  protected sendMessage(
    to: AgentType | 'user',
    content: string,
    type: AgentMessageType = 'response',
    data?: Record<string, unknown>
  ): AgentMessage {
    const message: AgentMessage = {
      id: uuidv4(),
      from: this.type,
      to,
      content,
      data,
      timestamp: Date.now(),
      type
    }

    this.eventBus.emit('message:sent', { message })
    return message
  }

  /**
   * Format a task into a prompt for the LLM.
   */
  protected formatTaskPrompt(task: AgentTask): string {
    let prompt = `Task: ${task.description}\n`

    if (Object.keys(task.context).length > 0) {
      prompt += '\nContext:\n'
      for (const [key, value] of Object.entries(task.context)) {
        prompt += `- ${key}: ${JSON.stringify(value)}\n`
      }
    }

    return prompt
  }

  /**
   * Process LLM response and execute any tool calls.
   */
  protected async processResponse(
    response: { content: string; toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> }
  ): Promise<unknown> {
    // Execute tool calls if present
    if (response.toolCalls.length > 0) {
      this.setStatus('executing')

      const results: Array<{ tool: string; result: unknown; success: boolean }> = []

      for (const toolCall of response.toolCalls) {
        const result = await this.executeTool(toolCall.name, toolCall.arguments)
        results.push({
          tool: toolCall.name,
          result: result.success ? result.result : result.error,
          success: result.success
        })
      }

      return {
        content: response.content,
        toolResults: results
      }
    }

    return {
      content: response.content
    }
  }

  /**
   * Reset the agent's context.
   */
  reset(): void {
    this.contextManager.resetContext(this.type)
    this.setStatus('idle')
  }
}

// ============================================================================
// Agent Factory
// ============================================================================

/**
 * Default settings for each agent type.
 * These are conservative defaults for small local models.
 */
export const DEFAULT_AGENT_SETTINGS: Record<AgentType, Partial<AgentSettings>> = {
  orchestrator: {
    maxTokens: 8192,
    temperature: 0.7
  },
  editor: {
    maxTokens: 4096,
    temperature: 0.3  // Lower for more deterministic edits
  },
  research: {
    maxTokens: 6144,
    temperature: 0.5
  },
  critique: {
    maxTokens: 6144,
    temperature: 0.5
  },
  style: {
    maxTokens: 4096,
    temperature: 0.5
  },
  creative: {
    maxTokens: 6144,
    temperature: 0.8  // Higher for more creative output
  }
}

/**
 * Merge agent settings with defaults.
 */
export function mergeAgentSettings(
  type: AgentType,
  settings: Partial<AgentSettings>,
  defaults: Partial<AgentSettings>
): AgentSettings {
  const typeDefaults = DEFAULT_AGENT_SETTINGS[type]

  return {
    model: settings.model || defaults.model || 'gpt-4o-mini',
    endpoint: settings.endpoint || defaults.endpoint || 'http://localhost:11434/v1',
    apiKey: settings.apiKey || defaults.apiKey,
    maxTokens: settings.maxTokens || defaults.maxTokens || typeDefaults.maxTokens || 4096,
    temperature: settings.temperature ?? defaults.temperature ?? typeDefaults.temperature ?? 0.7,
    timeout: settings.timeout || defaults.timeout || 60000
  }
}
