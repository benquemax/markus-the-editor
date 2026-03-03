/**
 * markus_tasks — Task Management Tool
 *
 * Wraps the existing task management system as a Claude Agent SDK MCP tool.
 * Provides CRUD operations for tracking work items during conversations.
 * Tasks are persisted to disk and displayed in the Markus UI.
 */

import {
  createTaskList,
  addTask,
  updateTaskStatus,
  removeTask,
  loadTaskList,
  saveTaskList,
  formatTaskListForPrompt,
  type Task
} from '../../tasks'

export interface TasksInput {
  action: 'list' | 'add' | 'update' | 'remove' | 'complete'
  workspaceId: string
  conversationId: string
  /** Required for 'add' action */
  description?: string
  priority?: number
  /** Required for 'update', 'remove', 'complete' actions */
  taskId?: string
  /** Required for 'update' action */
  status?: Task['status']
}

export interface TasksOutput {
  success: boolean
  taskList?: string
  taskId?: string
  error?: string
}

/**
 * Executes a task management operation.
 * Returns the formatted task list for LLM context injection.
 */
export async function executeTasks(input: TasksInput): Promise<TasksOutput> {
  const { action, workspaceId, conversationId } = input

  try {
    let taskList = await loadTaskList(workspaceId, conversationId)

    switch (action) {
      case 'list': {
        return {
          success: true,
          taskList: formatTaskListForPrompt(taskList)
        }
      }

      case 'add': {
        if (!input.description) {
          return { success: false, error: 'description is required for add action' }
        }
        if (!taskList) {
          taskList = createTaskList(conversationId)
        }
        const task = addTask(taskList, input.description, input.priority)
        await saveTaskList(workspaceId, taskList)
        return {
          success: true,
          taskId: task.id,
          taskList: formatTaskListForPrompt(taskList)
        }
      }

      case 'update': {
        if (!input.taskId || !input.status) {
          return { success: false, error: 'taskId and status are required for update action' }
        }
        if (!taskList) {
          return { success: false, error: 'No task list found' }
        }
        const updated = updateTaskStatus(taskList, input.taskId, input.status)
        if (!updated) {
          return { success: false, error: `Task ${input.taskId} not found` }
        }
        await saveTaskList(workspaceId, taskList)
        return {
          success: true,
          taskList: formatTaskListForPrompt(taskList)
        }
      }

      case 'remove': {
        if (!input.taskId) {
          return { success: false, error: 'taskId is required for remove action' }
        }
        if (!taskList) {
          return { success: false, error: 'No task list found' }
        }
        const removed = removeTask(taskList, input.taskId)
        if (!removed) {
          return { success: false, error: `Task ${input.taskId} not found` }
        }
        await saveTaskList(workspaceId, taskList)
        return {
          success: true,
          taskList: formatTaskListForPrompt(taskList)
        }
      }

      case 'complete': {
        if (!input.taskId) {
          return { success: false, error: 'taskId is required for complete action' }
        }
        if (!taskList) {
          return { success: false, error: 'No task list found' }
        }
        const completed = updateTaskStatus(taskList, input.taskId, 'done')
        if (!completed) {
          return { success: false, error: `Task ${input.taskId} not found` }
        }
        await saveTaskList(workspaceId, taskList)
        return {
          success: true,
          taskList: formatTaskListForPrompt(taskList)
        }
      }

      default:
        return { success: false, error: `Unknown action: ${action}` }
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
