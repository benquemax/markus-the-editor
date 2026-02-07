/**
 * Markus Task List Storage
 *
 * Manages persistent task lists for the thought loop architecture.
 * Task lists survive context condensation and keep the agent focused
 * on the current work. Each conversation has its own task list.
 *
 * Storage: ~/.config/markus-the-editor/filebars/{filebarId}/tasks/{conversationId}.json
 */

import path from 'path'
import fs from 'fs/promises'
import { existsSync } from 'fs'
import { v4 as uuidv4 } from 'uuid'
import { Task, TaskList } from './types'
import { getConfigDir } from './settings'

/**
 * Gets the tasks directory for a specific filebar.
 */
export function getTasksDir(filebarId: string): string {
  return path.join(getConfigDir(), 'filebars', filebarId, 'tasks')
}

/**
 * Ensures the tasks directory exists.
 */
async function ensureTasksDir(filebarId: string): Promise<string> {
  const dir = getTasksDir(filebarId)
  await fs.mkdir(dir, { recursive: true })
  return dir
}

/**
 * Gets the file path for a conversation's task list.
 */
function getTaskListPath(filebarId: string, conversationId: string): string {
  return path.join(getTasksDir(filebarId), `${conversationId}.json`)
}

/**
 * Loads the task list for a conversation.
 * Returns null if no task list exists.
 */
export async function loadTaskList(
  filebarId: string,
  conversationId: string
): Promise<TaskList | null> {
  const filePath = getTaskListPath(filebarId, conversationId)

  if (!existsSync(filePath)) {
    return null
  }

  try {
    const content = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(content) as TaskList
  } catch (error) {
    console.error('[Markus] Failed to load task list:', error)
    return null
  }
}

/**
 * Saves the task list to disk.
 */
export async function saveTaskList(
  filebarId: string,
  taskList: TaskList
): Promise<void> {
  await ensureTasksDir(filebarId)
  const filePath = getTaskListPath(filebarId, taskList.conversationId)

  taskList.updatedAt = Date.now()

  await fs.writeFile(filePath, JSON.stringify(taskList, null, 2), 'utf-8')
}

/**
 * Deletes the task list for a conversation (called on task approval).
 */
export async function deleteTaskList(
  filebarId: string,
  conversationId: string
): Promise<boolean> {
  const filePath = getTaskListPath(filebarId, conversationId)

  if (!existsSync(filePath)) {
    return false
  }

  try {
    await fs.unlink(filePath)
    return true
  } catch (error) {
    console.error('[Markus] Failed to delete task list:', error)
    return false
  }
}

/**
 * Creates a new empty task list for a conversation.
 */
export function createTaskList(conversationId: string): TaskList {
  const now = Date.now()
  return {
    conversationId,
    tasks: [],
    createdAt: now,
    updatedAt: now
  }
}

/**
 * Adds a task to the task list.
 * Returns the new task with generated ID.
 */
export function addTask(
  taskList: TaskList,
  description: string,
  priority: number = 0
): Task {
  const task: Task = {
    id: uuidv4(),
    description,
    status: 'pending',
    priority
  }

  taskList.tasks.push(task)
  taskList.updatedAt = Date.now()

  return task
}

/**
 * Updates a task's status.
 */
export function updateTaskStatus(
  taskList: TaskList,
  taskId: string,
  status: Task['status'],
  blockedBy?: string
): boolean {
  const task = taskList.tasks.find(t => t.id === taskId)
  if (!task) return false

  task.status = status
  if (status === 'done') {
    task.completedAt = Date.now()
  }
  if (blockedBy !== undefined) {
    task.blockedBy = blockedBy
  }

  taskList.updatedAt = Date.now()
  return true
}

/**
 * Updates a task's description.
 */
export function updateTaskDescription(
  taskList: TaskList,
  taskId: string,
  description: string
): boolean {
  const task = taskList.tasks.find(t => t.id === taskId)
  if (!task) return false

  task.description = description
  taskList.updatedAt = Date.now()
  return true
}

/**
 * Removes a task from the list.
 */
export function removeTask(taskList: TaskList, taskId: string): boolean {
  const index = taskList.tasks.findIndex(t => t.id === taskId)
  if (index === -1) return false

  taskList.tasks.splice(index, 1)
  taskList.updatedAt = Date.now()
  return true
}

/**
 * Marks multiple tasks as done.
 */
export function completeTasks(taskList: TaskList, taskIds: string[]): number {
  let completed = 0
  for (const taskId of taskIds) {
    if (updateTaskStatus(taskList, taskId, 'done')) {
      completed++
    }
  }
  return completed
}

/**
 * Gets the next pending task (highest priority first).
 */
export function getNextPendingTask(taskList: TaskList): Task | null {
  const pending = taskList.tasks
    .filter(t => t.status === 'pending')
    .sort((a, b) => b.priority - a.priority)

  return pending[0] || null
}

/**
 * Checks if all tasks are done.
 */
export function areAllTasksDone(taskList: TaskList): boolean {
  return taskList.tasks.length > 0 &&
    taskList.tasks.every(t => t.status === 'done')
}

/**
 * Formats the task list for injection into the system prompt.
 */
export function formatTaskListForPrompt(taskList: TaskList | null): string {
  if (!taskList || taskList.tasks.length === 0) {
    return 'No tasks defined yet. Use update_tasks to create your task list.'
  }

  const pending = taskList.tasks.filter(t => t.status === 'pending')
  const inProgress = taskList.tasks.filter(t => t.status === 'in_progress')
  const done = taskList.tasks.filter(t => t.status === 'done')
  const blocked = taskList.tasks.filter(t => t.status === 'blocked')

  let output = '## Current Tasks\n\n'

  if (inProgress.length > 0) {
    output += '### In Progress\n'
    for (const task of inProgress) {
      output += `- [~] ${task.description}\n`
    }
    output += '\n'
  }

  if (pending.length > 0) {
    output += '### Pending\n'
    for (const task of pending) {
      output += `- [ ] ${task.description}\n`
    }
    output += '\n'
  }

  if (blocked.length > 0) {
    output += '### Blocked\n'
    for (const task of blocked) {
      output += `- [!] ${task.description}${task.blockedBy ? ` (blocked: ${task.blockedBy})` : ''}\n`
    }
    output += '\n'
  }

  if (done.length > 0) {
    output += '### Done\n'
    for (const task of done) {
      output += `- [x] ${task.description}\n`
    }
    output += '\n'
  }

  const stats = `Progress: ${done.length}/${taskList.tasks.length} tasks complete`
  output += `\n${stats}`

  return output
}
