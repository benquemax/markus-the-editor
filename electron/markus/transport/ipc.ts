/**
 * IPC Transport
 *
 * Implements EventTransport for Electron IPC communication.
 * This wraps the existing mainWindow.webContents.send() calls
 * to maintain backward compatibility with the Electron app.
 */

import { BrowserWindow } from 'electron'
import type { EventTransport } from './types'
import type { ToolCallLog, ToolCallResult, BlockingToolUI, Task, ToolCallRecord } from '../types'

/**
 * Pending approval/response handlers.
 * Maps "conversationId:toolCallId" to resolve functions.
 */
interface PendingHandler {
  resolve: (value: string | boolean) => void
  reject: (error: Error) => void
  timeoutId: NodeJS.Timeout
}

/**
 * IPC Transport implementation for Electron.
 *
 * Sends events via mainWindow.webContents.send() and handles
 * responses via registered IPC handlers.
 */
export class IPCTransport implements EventTransport {
  private pendingResponses = new Map<string, PendingHandler>()
  private pendingApprovals = new Map<string, PendingHandler>()

  // Default timeout for blocking operations (5 minutes)
  private readonly TIMEOUT_MS = 5 * 60 * 1000

  constructor(
    private getMainWindow: () => BrowserWindow | null
  ) {}

  /**
   * Gets the main window, throwing if not available.
   */
  private getWindow(): BrowserWindow {
    const window = this.getMainWindow()
    if (!window) {
      throw new Error('No main window available')
    }
    return window
  }

  /**
   * Sends an IPC event to the renderer process.
   */
  private send(channel: string, data: unknown): void {
    try {
      const window = this.getWindow()
      window.webContents.send(channel, data)
    } catch (error) {
      console.error(`[IPCTransport] Failed to send ${channel}:`, error)
    }
  }

  // ============================================================================
  // EventTransport Implementation
  // ============================================================================

  sendChunk(conversationId: string, chunk: string): void {
    this.send('markus:messageChunk', { conversationId, chunk })
  }

  sendToolStarted(conversationId: string, toolCall: ToolCallLog): void {
    // Convert to ToolCallRecord format expected by renderer
    const toolCallRecord: ToolCallRecord = {
      id: toolCall.id,
      name: toolCall.name,
      arguments: toolCall.arguments,
      status: 'pending',
      startedAt: toolCall.startedAt
    }
    this.send('markus:toolCallStarted', { conversationId, toolCall: toolCallRecord })
  }

  sendToolComplete(conversationId: string, toolCallId: string, result: ToolCallResult): void {
    this.send('markus:toolCallComplete', {
      conversationId,
      toolCallId,
      result: {
        success: result.success,
        result: result.data,
        error: result.error
      }
    })
  }

  sendBlocking(conversationId: string, toolCallId: string, uiData: BlockingToolUI): void {
    this.send('markus:blockingTool', { conversationId, toolCallId, uiData })
  }

  sendTasksUpdated(conversationId: string, tasks: Task[]): void {
    this.send('markus:tasksUpdated', { conversationId, tasks })
  }

  sendComplete(conversationId: string, waitingForInput: boolean): void {
    this.send('markus:requestComplete', {
      conversationId,
      waitingForInput
    })
  }

  sendError(conversationId: string, message: string): void {
    this.send('markus:requestError', { conversationId, error: message })
  }

  sendIterationStarted(conversationId: string, iterationIndex: number): void {
    this.send('markus:iterationStarted', { conversationId, iterationIndex })
  }

  sendOpenFile(filePath: string): void {
    this.send('file:openPath', filePath)
  }

  waitForToolResponse(conversationId: string, toolCallId: string): Promise<string | boolean> {
    return this.createPendingPromise(this.pendingResponses, conversationId, toolCallId)
  }

  waitForToolApproval(conversationId: string, toolCallId: string): Promise<boolean> {
    return this.createPendingPromise(this.pendingApprovals, conversationId, toolCallId) as Promise<boolean>
  }

  // ============================================================================
  // Response Handling (called by IPC handlers)
  // ============================================================================

  /**
   * Resolves a pending tool response.
   * Called by the markus:submitUserResponse IPC handler.
   */
  resolveToolResponse(conversationId: string, toolCallId: string, response: string | boolean): boolean {
    return this.resolvePending(this.pendingResponses, conversationId, toolCallId, response)
  }

  /**
   * Resolves a pending tool approval.
   * Called by the markus:approveTool IPC handler.
   */
  resolveToolApproval(conversationId: string, toolCallId: string, approved: boolean): boolean {
    return this.resolvePending(this.pendingApprovals, conversationId, toolCallId, approved)
  }

  /**
   * Cancels all pending operations for a conversation.
   * Called when a conversation is cancelled or closed.
   */
  cancelPending(conversationId: string): void {
    const error = new Error('Request cancelled')

    for (const [key, handler] of this.pendingResponses.entries()) {
      if (key.startsWith(`${conversationId}:`)) {
        clearTimeout(handler.timeoutId)
        handler.reject(error)
        this.pendingResponses.delete(key)
      }
    }

    for (const [key, handler] of this.pendingApprovals.entries()) {
      if (key.startsWith(`${conversationId}:`)) {
        clearTimeout(handler.timeoutId)
        handler.reject(error)
        this.pendingApprovals.delete(key)
      }
    }
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Creates a pending promise that will be resolved by an IPC handler.
   */
  private createPendingPromise(
    map: Map<string, PendingHandler>,
    conversationId: string,
    toolCallId: string
  ): Promise<string | boolean> {
    return new Promise((resolve, reject) => {
      const key = `${conversationId}:${toolCallId}`

      // Set up timeout
      const timeoutId = setTimeout(() => {
        if (map.has(key)) {
          map.delete(key)
          reject(new Error('Timeout waiting for response'))
        }
      }, this.TIMEOUT_MS)

      map.set(key, { resolve, reject, timeoutId })
    })
  }

  /**
   * Resolves a pending promise from the map.
   */
  private resolvePending(
    map: Map<string, PendingHandler>,
    conversationId: string,
    toolCallId: string,
    value: string | boolean
  ): boolean {
    const key = `${conversationId}:${toolCallId}`
    const handler = map.get(key)

    if (handler) {
      clearTimeout(handler.timeoutId)
      handler.resolve(value)
      map.delete(key)
      return true
    }

    return false
  }
}

/**
 * Creates an IPC transport instance.
 */
export function createIPCTransport(getMainWindow: () => BrowserWindow | null): IPCTransport {
  return new IPCTransport(getMainWindow)
}
