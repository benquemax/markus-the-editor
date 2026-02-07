/**
 * Agent Router
 *
 * Coordinates task routing and agent orchestration.
 * The router receives tasks from the orchestrator and dispatches them
 * to appropriate specialist agents based on task type.
 */

import { v4 as uuidv4 } from 'uuid'
import {
  AgentType,
  AgentTask,
  MultiAgentSettings,
  AgentSettings
} from './types'
import { BaseAgent, mergeAgentSettings } from './base'
import { AgentEventBus, agentEventBus } from './eventBus'
import { AgentContextManager, agentContextManager } from './contextManager'

// ============================================================================
// Agent Registry
// ============================================================================

/**
 * Registry of agent instances.
 * Each agent type has a single instance managed by the router.
 */
export class AgentRegistry {
  private agents = new Map<AgentType, BaseAgent>()

  /**
   * Register an agent instance.
   */
  register(agent: BaseAgent): void {
    this.agents.set(agent.type, agent)
  }

  /**
   * Get an agent by type.
   */
  get(type: AgentType): BaseAgent | undefined {
    return this.agents.get(type)
  }

  /**
   * Get all registered agents.
   */
  getAll(): BaseAgent[] {
    return Array.from(this.agents.values())
  }

  /**
   * Check if an agent is registered.
   */
  has(type: AgentType): boolean {
    return this.agents.has(type)
  }

  /**
   * Remove an agent.
   */
  remove(type: AgentType): void {
    this.agents.delete(type)
  }

  /**
   * Clear all agents.
   */
  clear(): void {
    this.agents.clear()
  }
}

// ============================================================================
// Task Queue
// ============================================================================

/**
 * Priority queue for tasks.
 * Lower priority number = higher priority.
 */
export class TaskQueue {
  private tasks: AgentTask[] = []
  private taskMap = new Map<string, AgentTask>()

  /**
   * Add a task to the queue.
   */
  enqueue(task: AgentTask): void {
    this.tasks.push(task)
    this.taskMap.set(task.id, task)
    // Sort by priority (lower = higher priority)
    this.tasks.sort((a, b) => a.priority - b.priority)
  }

  /**
   * Get the next task for an agent type.
   */
  dequeue(agentType?: AgentType): AgentTask | undefined {
    const index = agentType
      ? this.tasks.findIndex(t => t.agent === agentType && t.status === 'pending')
      : this.tasks.findIndex(t => t.status === 'pending')

    if (index >= 0) {
      const task = this.tasks[index]
      return task
    }

    return undefined
  }

  /**
   * Get a task by ID.
   */
  get(taskId: string): AgentTask | undefined {
    return this.taskMap.get(taskId)
  }

  /**
   * Update a task.
   */
  update(taskId: string, updates: Partial<AgentTask>): void {
    const task = this.taskMap.get(taskId)
    if (task) {
      Object.assign(task, updates)
    }
  }

  /**
   * Remove completed/failed tasks.
   */
  cleanup(): void {
    const completedStatuses = ['complete', 'failed', 'cancelled']
    this.tasks = this.tasks.filter(t => !completedStatuses.includes(t.status))

    // Also clean up the map
    for (const [id, task] of this.taskMap.entries()) {
      if (completedStatuses.includes(task.status)) {
        this.taskMap.delete(id)
      }
    }
  }

  /**
   * Get all tasks.
   */
  getAll(): AgentTask[] {
    return [...this.tasks]
  }

  /**
   * Get pending tasks count.
   */
  getPendingCount(): number {
    return this.tasks.filter(t => t.status === 'pending').length
  }
}

// ============================================================================
// Agent Router
// ============================================================================

/**
 * Main router for the multi-agent system.
 * Handles task creation, routing, and agent lifecycle.
 */
export class AgentRouter {
  private registry = new AgentRegistry()
  private taskQueue = new TaskQueue()
  private eventBus: AgentEventBus
  private contextManager: AgentContextManager
  private settings: MultiAgentSettings
  private processing = false

  constructor(
    settings: MultiAgentSettings,
    eventBus: AgentEventBus = agentEventBus,
    contextManager: AgentContextManager = agentContextManager
  ) {
    this.settings = settings
    this.eventBus = eventBus
    this.contextManager = contextManager

    // Subscribe to task completion events
    this.eventBus.on('task:completed', () => {
      this.onTaskCompleted()
    })

    this.eventBus.on('task:updated', ({ task }) => {
      this.taskQueue.update(task.id, task)
    })
  }

  /**
   * Register an agent with the router.
   */
  registerAgent(agent: BaseAgent): void {
    this.registry.register(agent)
    agent.initialize()
  }

  /**
   * Get settings for an agent type.
   */
  getAgentSettings(type: AgentType): AgentSettings {
    const agentSpecific = this.settings[type] || {}
    const defaults = this.settings.defaults || {}
    return mergeAgentSettings(type, agentSpecific, defaults)
  }

  /**
   * Create and queue a task.
   */
  createTask(
    agent: AgentType,
    description: string,
    context: Record<string, unknown> = {},
    priority: number = 5,
    parentId?: string
  ): AgentTask {
    const task: AgentTask = {
      id: uuidv4(),
      description,
      agent,
      priority,
      status: 'pending',
      parentId,
      context,
      createdAt: Date.now()
    }

    this.taskQueue.enqueue(task)
    this.eventBus.emit('task:created', { task })

    // Start processing if not already
    this.processQueue()

    return task
  }

  /**
   * Route a user message to the appropriate agent.
   * By default, routes to the orchestrator, but can route to a specific
   * agent if targetAgent is specified in context.
   */
  async routeUserMessage(
    message: string,
    context: Record<string, unknown> = {}
  ): Promise<AgentTask> {
    // If a specific target agent is requested, route directly to it
    const targetAgent = context.targetAgent as AgentType | undefined
    const agent: AgentType = targetAgent && this.registry.get(targetAgent)
      ? targetAgent
      : 'orchestrator'

    return this.createTask(
      agent,
      message,
      context,
      1  // High priority for user messages
    )
  }

  /**
   * Process the task queue.
   */
  private async processQueue(): Promise<void> {
    if (this.processing) return
    this.processing = true

    try {
      while (this.taskQueue.getPendingCount() > 0) {
        // Get all pending tasks grouped by agent
        const tasksByAgent = this.groupTasksByAgent()

        // Process tasks in parallel (one per agent)
        const promises: Promise<void>[] = []

        for (const [agentType, tasks] of tasksByAgent.entries()) {
          const agent = this.registry.get(agentType)
          if (agent && agent.getStatus() === 'idle' && tasks.length > 0) {
            const task = tasks[0]  // Take first (highest priority)
            promises.push(agent.processTask(task))
          }
        }

        if (promises.length === 0) {
          // No agents available, wait a bit
          await new Promise(resolve => setTimeout(resolve, 100))
        } else {
          // Wait for at least one to complete
          await Promise.race(promises)
        }
      }
    } finally {
      this.processing = false
    }
  }

  /**
   * Group pending tasks by agent type.
   */
  private groupTasksByAgent(): Map<AgentType, AgentTask[]> {
    const grouped = new Map<AgentType, AgentTask[]>()
    const allTasks = this.taskQueue.getAll()

    for (const task of allTasks) {
      if (task.status !== 'pending') continue

      const existing = grouped.get(task.agent) || []
      existing.push(task)
      grouped.set(task.agent, existing)
    }

    return grouped
  }

  /**
   * Handle task completion.
   */
  private onTaskCompleted(): void {
    // Clean up completed tasks periodically
    if (this.taskQueue.getAll().filter(t => t.status === 'complete').length > 100) {
      this.taskQueue.cleanup()
    }

    // Resume queue processing
    this.processQueue()
  }

  /**
   * Cancel a task.
   */
  cancelTask(taskId: string): void {
    const task = this.taskQueue.get(taskId)
    if (!task) return

    if (task.status === 'pending') {
      task.status = 'cancelled'
      this.eventBus.emit('task:updated', { task })
    } else if (task.status === 'in_progress') {
      const agent = this.registry.get(task.agent)
      if (agent) {
        agent.cancel()
      }
    }
  }

  /**
   * Cancel all tasks.
   */
  cancelAll(): void {
    for (const task of this.taskQueue.getAll()) {
      this.cancelTask(task.id)
    }
  }

  /**
   * Get task status.
   */
  getTaskStatus(taskId: string): AgentTask | undefined {
    return this.taskQueue.get(taskId)
  }

  /**
   * Get all agent statuses.
   */
  getAgentStatuses(): Array<{ type: AgentType; status: string }> {
    return this.registry.getAll().map(agent => ({
      type: agent.type,
      status: agent.getStatus()
    }))
  }

  /**
   * Reset all agents.
   */
  reset(): void {
    this.cancelAll()
    for (const agent of this.registry.getAll()) {
      agent.reset()
    }
    this.taskQueue.cleanup()
  }

  /**
   * Shutdown the router.
   */
  shutdown(): void {
    this.cancelAll()
    this.registry.clear()
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let routerInstance: AgentRouter | null = null

/**
 * Get or create the global agent router.
 */
export function getAgentRouter(settings?: MultiAgentSettings): AgentRouter {
  if (!routerInstance && settings) {
    routerInstance = new AgentRouter(settings)
  }
  if (!routerInstance) {
    throw new Error('AgentRouter not initialized. Call with settings first.')
  }
  return routerInstance
}

/**
 * Reset the global router instance.
 */
export function resetAgentRouter(): void {
  if (routerInstance) {
    routerInstance.shutdown()
    routerInstance = null
  }
}
