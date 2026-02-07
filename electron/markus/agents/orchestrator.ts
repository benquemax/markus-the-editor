/**
 * Orchestrator Agent
 *
 * User-facing coordinator agent that decomposes tasks and routes them
 * to specialist agents. This is the main entry point for all user requests.
 * Optimized for larger models like Devstral 24B.
 */

import { v4 as uuidv4 } from 'uuid'
import {
  AgentType,
  AgentSettings,
  AgentTask
} from './types'
import { BaseAgent } from './base'
import { AgentRouter } from './router'
import { ToolDefinition } from '../types'
import { agentEventBus } from './eventBus'
import { agentContextManager } from './contextManager'

// ============================================================================
// Task Parsing
// ============================================================================

/**
 * Parsed agent request from orchestrator output.
 */
interface ParsedAgentRequest {
  agent: AgentType
  task: string
}

/**
 * Parse agent requests from orchestrator response.
 *
 * Expected format:
 * <agent_request agent="research">
 * task description here
 * </agent_request>
 */
function parseAgentRequests(content: string): ParsedAgentRequest[] {
  const requests: ParsedAgentRequest[] = []
  const regex = /<agent_request\s+agent="([^"]+)">([\s\S]*?)<\/agent_request>/g

  let match
  while ((match = regex.exec(content)) !== null) {
    const agent = match[1] as AgentType
    const task = match[2].trim()

    // Validate agent type
    const validAgents: AgentType[] = ['editor', 'research', 'critique', 'style', 'creative']
    if (validAgents.includes(agent)) {
      requests.push({ agent, task })
    }
  }

  return requests
}

// ============================================================================
// Orchestrator Agent
// ============================================================================

/**
 * Orchestrator agent for task coordination.
 */
export class OrchestratorAgent extends BaseAgent {
  readonly type: AgentType = 'orchestrator'

  /** Router for delegating to other agents */
  private router: AgentRouter | null = null

  /** Workspace folders */
  private workspaceFolders: string[] = []

  constructor(
    settings: AgentSettings,
    workspaceFolders: string[] = []
  ) {
    super(settings, agentEventBus, agentContextManager)
    this.workspaceFolders = workspaceFolders
  }

  /**
   * Set the agent router.
   */
  setRouter(router: AgentRouter): void {
    this.router = router
  }

  /**
   * Update workspace folders.
   */
  setWorkspaceFolders(folders: string[]): void {
    this.workspaceFolders = folders
  }

  /**
   * Get tool definitions for the orchestrator.
   */
  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'delegate_task',
        description: 'Delegate a task to a specialist agent',
        parameters: {
          type: 'object',
          properties: {
            agent: {
              type: 'string',
              description: 'Agent to delegate to: research, editor, critique, style, creative',
              enum: ['research', 'editor', 'critique', 'style', 'creative']
            },
            task: {
              type: 'string',
              description: 'Task description for the agent'
            },
            context: {
              type: 'string',
              description: 'Additional context for the task'
            }
          },
          required: ['agent', 'task']
        }
      },
      {
        name: 'get_status',
        description: 'Get status of all agents and pending tasks',
        parameters: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'approve_edit',
        description: 'Approve or reject a proposed edit from the editor agent',
        parameters: {
          type: 'object',
          properties: {
            editId: {
              type: 'string',
              description: 'Edit ID to approve or reject'
            },
            approved: {
              type: 'boolean',
              description: 'Whether to approve the edit'
            }
          },
          required: ['editId', 'approved']
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
      case 'delegate_task':
        return this.executeDelegateTask(args)
      case 'get_status':
        return this.executeGetStatus()
      case 'approve_edit':
        return this.executeApproveEdit(args)
      default:
        return { success: false, error: `Unknown tool: ${toolName}` }
    }
  }

  /**
   * Delegate a task to another agent.
   */
  private async executeDelegateTask(
    args: Record<string, unknown>
  ): Promise<{ success: boolean; result?: unknown; error?: string }> {
    const agent = String(args.agent || '') as AgentType
    const task = String(args.task || '')
    const context = args.context ? String(args.context) : ''

    if (!agent || !task) {
      return { success: false, error: 'Agent and task are required' }
    }

    if (!this.router) {
      return { success: false, error: 'Router not initialized' }
    }

    // Create task for the specified agent
    const agentTask = this.router.createTask(
      agent,
      task,
      {
        workspaceFolders: this.workspaceFolders,
        additionalContext: context,
        parentTaskId: this.currentTask?.id
      },
      3 // Medium priority for delegated tasks
    )

    return {
      success: true,
      result: {
        taskId: agentTask.id,
        agent,
        status: agentTask.status
      }
    }
  }

  /**
   * Get status of all agents.
   */
  private executeGetStatus(): {
    success: boolean
    result?: unknown
    error?: string
  } {
    if (!this.router) {
      return { success: false, error: 'Router not initialized' }
    }

    const statuses = this.router.getAgentStatuses()
    return {
      success: true,
      result: statuses
    }
  }

  /**
   * Approve or reject an edit.
   */
  private async executeApproveEdit(
    args: Record<string, unknown>
  ): Promise<{ success: boolean; result?: unknown; error?: string }> {
    const editId = String(args.editId || '')
    const approved = Boolean(args.approved)

    if (!editId) {
      return { success: false, error: 'Edit ID is required' }
    }

    // Emit approval event
    this.eventBus.emit('message:sent', {
      message: {
        id: uuidv4(),
        from: 'orchestrator',
        to: 'editor',
        content: approved ? 'Edit approved' : 'Edit rejected',
        data: { editId, approved },
        timestamp: Date.now(),
        type: 'approval'
      }
    })

    return {
      success: true,
      result: { editId, approved }
    }
  }

  /**
   * Process LLM response and handle agent requests.
   */
  protected async processResponse(
    response: { content: string; toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> },
    task: AgentTask
  ): Promise<unknown> {
    // First, check for tool calls
    const baseResult = await super.processResponse(response, task)

    // Then, check for agent request tags in content
    const agentRequests = parseAgentRequests(response.content)

    if (agentRequests.length > 0 && this.router) {
      const delegatedTasks: Array<{ agent: AgentType; taskId: string }> = []

      for (const request of agentRequests) {
        const agentTask = this.router.createTask(
          request.agent,
          request.task,
          {
            workspaceFolders: this.workspaceFolders,
            parentTaskId: task.id
          },
          3
        )

        delegatedTasks.push({
          agent: request.agent,
          taskId: agentTask.id
        })
      }

      return {
        ...(baseResult as Record<string, unknown>),
        delegatedTasks
      }
    }

    return baseResult
  }
}

/**
 * Create an orchestrator agent with the given settings.
 */
export function createOrchestratorAgent(
  settings: AgentSettings,
  workspaceFolders: string[] = []
): OrchestratorAgent {
  const agent = new OrchestratorAgent(settings, workspaceFolders)
  agent.initialize()
  return agent
}
