/**
 * Markus Task List Storage
 *
 * Manages persistent task lists for the thought loop architecture.
 * Task lists survive context condensation and keep the agent focused
 * on the current work. Each conversation has its own task list.
 *
 * Storage: ~/.config/markus-the-editor/workspaces/{workspaceId}/tasks/{conversationId}.json
 */

import path from 'path'
import fs from 'fs/promises'
import { existsSync } from 'fs'
import { Task, TaskList } from './types'
import { getConfigDir } from './settings'

/**
 * Gets the tasks directory for a specific workspace.
 */
export function getTasksDir(workspaceId: string): string {
  return path.join(getConfigDir(), 'workspaces', workspaceId, 'tasks')
}

/**
 * Ensures the tasks directory exists.
 */
async function ensureTasksDir(workspaceId: string): Promise<string> {
  const dir = getTasksDir(workspaceId)
  await fs.mkdir(dir, { recursive: true })
  return dir
}

/**
 * Gets the file path for a conversation's task list.
 */
function getTaskListPath(workspaceId: string, conversationId: string): string {
  return path.join(getTasksDir(workspaceId), `${conversationId}.json`)
}

/**
 * Deduplicates and normalizes a task list.
 * - Removes duplicate tasks (same description, keeping earliest)
 * - Migrates legacy UUID IDs to short IDs
 */
function cleanupTaskList(taskList: TaskList): void {
  const seenDescriptions = new Map<string, Task>()
  const cleanedTasks: Task[] = []

  for (const task of taskList.tasks) {
    const normalizedDesc = task.description.toLowerCase().trim()

    // Check for duplicate
    const existing = seenDescriptions.get(normalizedDesc)
    if (existing) {
      // Keep the one with higher priority or done status
      if (task.status === 'done' && existing.status !== 'done') {
        // Replace with done version
        const idx = cleanedTasks.indexOf(existing)
        cleanedTasks[idx] = task
        seenDescriptions.set(normalizedDesc, task)
      }
      continue
    }

    seenDescriptions.set(normalizedDesc, task)
    cleanedTasks.push(task)
  }

  // Reassign short IDs if any have legacy UUID format
  const needsReindex = cleanedTasks.some(t => !t.id.match(/^t\d+$/))
  if (needsReindex) {
    cleanedTasks.forEach((task, idx) => {
      task.id = `t${idx + 1}`
    })
  }

  taskList.tasks = cleanedTasks
  taskList.updatedAt = Date.now()
}

/**
 * Loads the task list for a conversation.
 * Returns null if no task list exists.
 * Automatically cleans up duplicates and migrates legacy IDs.
 */
export async function loadTaskList(
  workspaceId: string,
  conversationId: string
): Promise<TaskList | null> {
  const filePath = getTaskListPath(workspaceId, conversationId)

  if (!existsSync(filePath)) {
    return null
  }

  try {
    const content = await fs.readFile(filePath, 'utf-8')
    const taskList = JSON.parse(content) as TaskList

    // Clean up any duplicates or legacy IDs
    const originalCount = taskList.tasks.length
    cleanupTaskList(taskList)

    if (taskList.tasks.length !== originalCount) {
      console.log(`[Markus] Cleaned up ${originalCount - taskList.tasks.length} duplicate tasks`)
      // Save the cleaned up list
      await saveTaskList(workspaceId, taskList)
    }

    return taskList
  } catch (error) {
    console.error('[Markus] Failed to load task list:', error)
    return null
  }
}

/**
 * Saves the task list to disk.
 */
export async function saveTaskList(
  workspaceId: string,
  taskList: TaskList
): Promise<void> {
  await ensureTasksDir(workspaceId)
  const filePath = getTaskListPath(workspaceId, taskList.conversationId)

  taskList.updatedAt = Date.now()

  await fs.writeFile(filePath, JSON.stringify(taskList, null, 2), 'utf-8')
}

/**
 * Deletes the task list for a conversation (called on task approval).
 */
export async function deleteTaskList(
  workspaceId: string,
  conversationId: string
): Promise<boolean> {
  const filePath = getTaskListPath(workspaceId, conversationId)

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
 * Generates a short sequential ID for tasks within a conversation.
 * Uses format: t1, t2, t3, etc.
 */
function generateShortId(taskList: TaskList): string {
  // Find the highest existing numeric ID
  let maxNum = 0
  for (const task of taskList.tasks) {
    const match = task.id.match(/^t(\d+)$/)
    if (match) {
      maxNum = Math.max(maxNum, parseInt(match[1], 10))
    }
  }
  return `t${maxNum + 1}`
}

/**
 * Adds a task to the task list.
 * Returns the new task with generated ID.
 * Skips duplicates - if a task with the same description already exists
 * (and isn't done), returns the existing task instead.
 */
export function addTask(
  taskList: TaskList,
  description: string,
  priority: number = 0
): Task {
  // Check for existing task with same description (case-insensitive)
  const normalizedDesc = description.toLowerCase().trim()
  const existing = taskList.tasks.find(
    t => t.description.toLowerCase().trim() === normalizedDesc && t.status !== 'done'
  )

  if (existing) {
    // Update priority if higher
    if (priority > existing.priority) {
      existing.priority = priority
      taskList.updatedAt = Date.now()
    }
    return existing
  }

  const task: Task = {
    id: generateShortId(taskList),
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
 * Includes task IDs so the LLM can reference them when marking tasks complete.
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
  output += 'Use the task ID when calling update_tasks with complete/update/remove.\n\n'

  if (inProgress.length > 0) {
    output += '### In Progress\n'
    for (const task of inProgress) {
      output += `- [~] (${task.id}) ${task.description}\n`
    }
    output += '\n'
  }

  if (pending.length > 0) {
    output += '### Pending\n'
    for (const task of pending) {
      output += `- [ ] (${task.id}) ${task.description}\n`
    }
    output += '\n'
  }

  if (blocked.length > 0) {
    output += '### Blocked\n'
    for (const task of blocked) {
      output += `- [!] (${task.id}) ${task.description}${task.blockedBy ? ` (blocked: ${task.blockedBy})` : ''}\n`
    }
    output += '\n'
  }

  if (done.length > 0) {
    output += '### Done\n'
    for (const task of done) {
      output += `- [x] (${task.id}) ${task.description}\n`
    }
    output += '\n'
  }

  const stats = `Progress: ${done.length}/${taskList.tasks.length} tasks complete`
  output += `\n${stats}`

  return output
}
