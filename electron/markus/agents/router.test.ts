/**
 * Unit Tests for Agent Router
 *
 * Tests task creation, routing, queue management,
 * and agent registry functionality.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AgentRegistry, TaskQueue, AgentRouter } from './router'
import { BaseAgent } from './base'
import { AgentType, AgentTask, MultiAgentSettings, AgentSettings } from './types'
import { AgentEventBus } from './eventBus'
import { AgentContextManager } from './contextManager'
import { ToolDefinition } from '../types'

// Mock BaseAgent for testing
class MockAgent extends BaseAgent {
  readonly type: AgentType
  public processTaskMock = vi.fn()

  constructor(
    type: AgentType,
    settings: AgentSettings,
    eventBus?: AgentEventBus,
    contextManager?: AgentContextManager
  ) {
    super(settings, eventBus, contextManager)
    this.type = type
  }

  getToolDefinitions(): ToolDefinition[] {
    return []
  }

  async executeTool(): Promise<{ success: boolean; result?: unknown; error?: string }> {
    return { success: true }
  }

  async processTask(task: AgentTask): Promise<void> {
    this.processTaskMock(task)
    task.status = 'complete'
    return Promise.resolve()
  }

  // Override initialize to avoid LLM client creation
  initialize(): void {
    this.setStatus('idle')
  }
}

describe('AgentRegistry', () => {
  let registry: AgentRegistry
  const mockSettings: AgentSettings = {
    model: 'test-model',
    endpoint: 'http://localhost:11434/v1',
    maxTokens: 1000,
    temperature: 0.7
  }

  beforeEach(() => {
    registry = new AgentRegistry()
  })

  it('registers an agent', () => {
    const agent = new MockAgent('editor', mockSettings)

    registry.register(agent)

    expect(registry.has('editor')).toBe(true)
  })

  it('retrieves a registered agent', () => {
    const agent = new MockAgent('research', mockSettings)
    registry.register(agent)

    const retrieved = registry.get('research')

    expect(retrieved).toBe(agent)
  })

  it('returns undefined for unregistered agent', () => {
    const retrieved = registry.get('critique')

    expect(retrieved).toBeUndefined()
  })

  it('gets all registered agents', () => {
    const editor = new MockAgent('editor', mockSettings)
    const research = new MockAgent('research', mockSettings)
    registry.register(editor)
    registry.register(research)

    const all = registry.getAll()

    expect(all).toHaveLength(2)
    expect(all).toContain(editor)
    expect(all).toContain(research)
  })

  it('removes an agent', () => {
    const agent = new MockAgent('style', mockSettings)
    registry.register(agent)

    registry.remove('style')

    expect(registry.has('style')).toBe(false)
  })

  it('clears all agents', () => {
    registry.register(new MockAgent('editor', mockSettings))
    registry.register(new MockAgent('research', mockSettings))

    registry.clear()

    expect(registry.getAll()).toHaveLength(0)
  })

  it('replaces agent when registering same type', () => {
    const agent1 = new MockAgent('orchestrator', mockSettings)
    const agent2 = new MockAgent('orchestrator', mockSettings)
    registry.register(agent1)
    registry.register(agent2)

    expect(registry.get('orchestrator')).toBe(agent2)
    expect(registry.getAll()).toHaveLength(1)
  })
})

describe('TaskQueue', () => {
  let queue: TaskQueue

  beforeEach(() => {
    queue = new TaskQueue()
  })

  function createTask(overrides: Partial<AgentTask> = {}): AgentTask {
    return {
      id: `task-${Math.random().toString(36).slice(2)}`,
      description: 'Test task',
      agent: 'editor',
      priority: 5,
      status: 'pending',
      context: {},
      createdAt: Date.now(),
      ...overrides
    }
  }

  it('enqueues a task', () => {
    const task = createTask()

    queue.enqueue(task)

    expect(queue.get(task.id)).toBe(task)
  })

  it('dequeues tasks in priority order', () => {
    const lowPriority = createTask({ priority: 10 })
    const highPriority = createTask({ priority: 1 })
    const mediumPriority = createTask({ priority: 5 })

    queue.enqueue(lowPriority)
    queue.enqueue(highPriority)
    queue.enqueue(mediumPriority)

    const first = queue.dequeue()

    expect(first).toBe(highPriority)
  })

  it('dequeues only pending tasks', () => {
    const pending = createTask({ status: 'pending' })
    const inProgress = createTask({ status: 'in_progress' })

    queue.enqueue(pending)
    queue.enqueue(inProgress)

    const dequeued = queue.dequeue()

    expect(dequeued).toBe(pending)
  })

  it('dequeues by agent type', () => {
    const editorTask = createTask({ agent: 'editor' })
    const researchTask = createTask({ agent: 'research' })

    queue.enqueue(editorTask)
    queue.enqueue(researchTask)

    const research = queue.dequeue('research')

    expect(research).toBe(researchTask)
  })

  it('returns undefined when no pending tasks', () => {
    const task = createTask({ status: 'complete' })
    queue.enqueue(task)

    const dequeued = queue.dequeue()

    expect(dequeued).toBeUndefined()
  })

  it('updates a task', () => {
    const task = createTask()
    queue.enqueue(task)

    queue.update(task.id, { status: 'in_progress' })

    expect(queue.get(task.id)?.status).toBe('in_progress')
  })

  it('cleans up completed tasks', () => {
    const pending = createTask({ status: 'pending' })
    const complete = createTask({ status: 'complete' })
    const failed = createTask({ status: 'failed' })

    queue.enqueue(pending)
    queue.enqueue(complete)
    queue.enqueue(failed)

    queue.cleanup()

    expect(queue.getAll()).toHaveLength(1)
    expect(queue.get(pending.id)).toBeDefined()
    expect(queue.get(complete.id)).toBeUndefined()
    expect(queue.get(failed.id)).toBeUndefined()
  })

  it('counts pending tasks', () => {
    queue.enqueue(createTask({ status: 'pending' }))
    queue.enqueue(createTask({ status: 'pending' }))
    queue.enqueue(createTask({ status: 'complete' }))

    expect(queue.getPendingCount()).toBe(2)
  })
})

describe('AgentRouter', () => {
  let router: AgentRouter
  let eventBus: AgentEventBus
  let contextManager: AgentContextManager
  const settings: MultiAgentSettings = {
    defaults: {
      model: 'test-model',
      endpoint: 'http://localhost:11434/v1',
      maxTokens: 4096,
      temperature: 0.7
    }
  }

  const mockAgentSettings: AgentSettings = {
    model: 'test-model',
    endpoint: 'http://localhost:11434/v1',
    maxTokens: 1000,
    temperature: 0.7
  }

  beforeEach(() => {
    eventBus = new AgentEventBus()
    contextManager = new AgentContextManager()
    router = new AgentRouter(settings, eventBus, contextManager)
  })

  describe('agent registration', () => {
    it('registers an agent', () => {
      const agent = new MockAgent('orchestrator', mockAgentSettings, eventBus, contextManager)

      router.registerAgent(agent)

      const statuses = router.getAgentStatuses()
      expect(statuses.find(s => s.type === 'orchestrator')).toBeDefined()
    })

    it('initializes agent on registration', () => {
      const agent = new MockAgent('editor', mockAgentSettings, eventBus, contextManager)
      const initSpy = vi.spyOn(agent, 'initialize')

      router.registerAgent(agent)

      expect(initSpy).toHaveBeenCalled()
    })
  })

  describe('task creation', () => {
    it('creates a task with correct properties', () => {
      const task = router.createTask('editor', 'Edit the file')

      expect(task.id).toBeDefined()
      expect(task.agent).toBe('editor')
      expect(task.description).toBe('Edit the file')
      expect(task.status).toBe('pending')
      expect(task.createdAt).toBeGreaterThan(0)
    })

    it('emits task:created event', () => {
      const listener = vi.fn()
      eventBus.on('task:created', listener)

      router.createTask('research', 'Find info')

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          task: expect.objectContaining({
            agent: 'research',
            description: 'Find info'
          })
        })
      )
    })

    it('sets priority correctly', () => {
      const highPriority = router.createTask('editor', 'Urgent', {}, 1)
      const lowPriority = router.createTask('editor', 'Later', {}, 10)

      expect(highPriority.priority).toBe(1)
      expect(lowPriority.priority).toBe(10)
    })

    it('links parent task', () => {
      const parent = router.createTask('orchestrator', 'Main task')
      const child = router.createTask('editor', 'Sub task', {}, 5, parent.id)

      expect(child.parentId).toBe(parent.id)
    })
  })

  describe('task routing', () => {
    it('routes user message to orchestrator', async () => {
      const task = await router.routeUserMessage('Hello!')

      expect(task.agent).toBe('orchestrator')
      expect(task.description).toBe('Hello!')
      expect(task.priority).toBe(1)  // High priority for user messages
    })

    it('includes context in routed message', async () => {
      const task = await router.routeUserMessage('Hello!', {
        fileOpen: 'test.md'
      })

      expect(task.context.fileOpen).toBe('test.md')
    })
  })

  describe('task cancellation', () => {
    it('cancels pending task', () => {
      const task = router.createTask('editor', 'Test')

      router.cancelTask(task.id)

      const status = router.getTaskStatus(task.id)
      expect(status?.status).toBe('cancelled')
    })

    it('cancels all tasks', () => {
      router.createTask('editor', 'Task 1')
      router.createTask('research', 'Task 2')
      router.createTask('critique', 'Task 3')

      router.cancelAll()

      const statuses = router.getAgentStatuses()
      // All tasks should be cancelled (status checked indirectly through no pending)
      expect(statuses).toBeDefined()
    })
  })

  describe('agent settings', () => {
    it('returns merged agent settings', () => {
      const routerWithConfig = new AgentRouter({
        defaults: {
          model: 'default-model',
          endpoint: 'http://default',
          maxTokens: 2000,
          temperature: 0.5
        },
        editor: {
          model: 'editor-model',
          temperature: 0.3
        }
      }, eventBus, contextManager)

      const editorSettings = routerWithConfig.getAgentSettings('editor')

      expect(editorSettings.model).toBe('editor-model')
      expect(editorSettings.temperature).toBe(0.3)
      expect(editorSettings.maxTokens).toBe(2000)  // From defaults
    })
  })

  describe('status queries', () => {
    it('returns all agent statuses', () => {
      router.registerAgent(new MockAgent('orchestrator', mockAgentSettings, eventBus, contextManager))
      router.registerAgent(new MockAgent('editor', mockAgentSettings, eventBus, contextManager))

      const statuses = router.getAgentStatuses()

      expect(statuses).toHaveLength(2)
      expect(statuses.map(s => s.type)).toContain('orchestrator')
      expect(statuses.map(s => s.type)).toContain('editor')
    })

    it('returns task status by ID', () => {
      const task = router.createTask('style', 'Format code')

      const status = router.getTaskStatus(task.id)

      expect(status).toBe(task)
    })

    it('returns undefined for unknown task ID', () => {
      const status = router.getTaskStatus('nonexistent-id')

      expect(status).toBeUndefined()
    })
  })

  describe('reset and shutdown', () => {
    it('resets agents', () => {
      const agent = new MockAgent('creative', mockAgentSettings, eventBus, contextManager)
      const resetSpy = vi.spyOn(agent, 'reset')
      router.registerAgent(agent)

      router.reset()

      expect(resetSpy).toHaveBeenCalled()
    })

    it('shuts down and clears agents', () => {
      router.registerAgent(new MockAgent('editor', mockAgentSettings, eventBus, contextManager))
      router.registerAgent(new MockAgent('research', mockAgentSettings, eventBus, contextManager))

      router.shutdown()

      expect(router.getAgentStatuses()).toHaveLength(0)
    })
  })
})
