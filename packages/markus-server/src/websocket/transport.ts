/**
 * WebSocket Transport
 *
 * Implements the EventTransport interface for WebSocket communication.
 * Sends events to connected WebSocket clients and handles responses
 * for blocking tools.
 */

import { WebSocket } from 'ws'
import type { ServerMessage, ToolCallInfo, ToolCallResult, BlockingToolUI, Task } from '../types'

/**
 * Pending response handlers for blocking operations.
 */
interface PendingHandler {
  resolve: (value: string | boolean) => void
  reject: (error: Error) => void
  timeoutId: NodeJS.Timeout
}

/**
 * WebSocket transport implementation.
 *
 * Provides bidirectional communication for a single conversation
 * over a WebSocket connection.
 */
export class WebSocketTransport {
  private pendingResponses = new Map<string, PendingHandler>()
  private pendingApprovals = new Map<string, PendingHandler>()

  // Timeout for blocking operations (2 minutes).
  // Covers ask_user and request_task_approval which require client interaction.
  // Tool approval should never reach here in server mode (yoloMode is forced on)
  // but this timeout prevents indefinite hangs if it ever does.
  private readonly TIMEOUT_MS = 2 * 60 * 1000

  constructor(
    private ws: WebSocket,
    private conversationId: string
  ) {}

  /**
   * Sends a message over the WebSocket.
   */
  private send(message: ServerMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    } else {
      console.warn('[WebSocketTransport] Cannot send - connection not open')
    }
  }

  // ============================================================================
  // EventTransport Implementation
  // ============================================================================

  sendChunk(chunk: string): void {
    this.send({ type: 'chunk', content: chunk })
  }

  sendToolStarted(toolCall: { id: string; name: string; arguments: Record<string, unknown>; blocking?: boolean }): void {
    const toolCallInfo: ToolCallInfo = {
      id: toolCall.id,
      name: toolCall.name,
      arguments: toolCall.arguments,
      blocking: toolCall.blocking
    }
    this.send({ type: 'tool_started', toolCall: toolCallInfo })
  }

  sendToolComplete(toolCallId: string, result: ToolCallResult): void {
    this.send({ type: 'tool_complete', toolCallId, result })
  }

  sendBlocking(toolCallId: string, uiData: BlockingToolUI): void {
    this.send({ type: 'blocking', toolCallId, uiData })
  }

  sendTasksUpdated(tasks: Task[]): void {
    this.send({ type: 'tasks_updated', tasks })
  }

  sendComplete(waitingForInput: boolean): void {
    this.send({ type: 'complete', waitingForInput })
  }

  sendError(message: string): void {
    this.send({ type: 'error', message })
  }

  sendIterationStarted(iterationIndex: number): void {
    this.send({ type: 'iteration_started', iterationIndex })
  }

  sendOpenFile(_filePath: string): void {
    // WebSocket clients don't support file opening directly
    // Could be implemented as a custom message type if needed
  }

  /**
   * Waits for a response from the client to a blocking tool.
   */
  waitForToolResponse(toolCallId: string): Promise<string | boolean> {
    return this.createPendingPromise(this.pendingResponses, toolCallId)
  }

  /**
   * Waits for tool approval from the client.
   */
  waitForToolApproval(toolCallId: string): Promise<boolean> {
    return this.createPendingPromise(this.pendingApprovals, toolCallId) as Promise<boolean>
  }

  // ============================================================================
  // Response Handling (called by WebSocket handler)
  // ============================================================================

  /**
   * Resolves a pending tool response.
   */
  resolveToolResponse(toolCallId: string, response: string | boolean): boolean {
    return this.resolvePending(this.pendingResponses, toolCallId, response)
  }

  /**
   * Resolves a pending tool approval.
   */
  resolveToolApproval(toolCallId: string, approved: boolean): boolean {
    return this.resolvePending(this.pendingApprovals, toolCallId, approved)
  }

  /**
   * Cancels all pending operations.
   */
  cancelAll(): void {
    const error = new Error('Request cancelled')

    for (const handler of this.pendingResponses.values()) {
      clearTimeout(handler.timeoutId)
      handler.reject(error)
    }
    this.pendingResponses.clear()

    for (const handler of this.pendingApprovals.values()) {
      clearTimeout(handler.timeoutId)
      handler.reject(error)
    }
    this.pendingApprovals.clear()
  }

  /**
   * Gets the conversation ID for this transport.
   */
  getConversationId(): string {
    return this.conversationId
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private createPendingPromise(
    map: Map<string, PendingHandler>,
    toolCallId: string
  ): Promise<string | boolean> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (map.has(toolCallId)) {
          map.delete(toolCallId)
          reject(new Error('Timeout waiting for response'))
        }
      }, this.TIMEOUT_MS)

      map.set(toolCallId, { resolve, reject, timeoutId })
    })
  }

  private resolvePending(
    map: Map<string, PendingHandler>,
    toolCallId: string,
    value: string | boolean
  ): boolean {
    const handler = map.get(toolCallId)
    if (handler) {
      clearTimeout(handler.timeoutId)
      handler.resolve(value)
      map.delete(toolCallId)
      return true
    }
    return false
  }
}
