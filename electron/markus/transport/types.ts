/**
 * Event Transport Types
 *
 * Abstracts the communication layer between the thought loop and clients.
 * This allows the same core logic to work with:
 * - Electron IPC (mainWindow.webContents.send)
 * - WebSocket connections (for standalone server)
 * - Other transport mechanisms (tests, CLI, etc.)
 */

import type { ToolCallLog, ToolCallResult, BlockingToolUI, Task } from '../types'

// ============================================================================
// WebSocket Protocol Message Types
// ============================================================================

/**
 * Messages sent from client to server over WebSocket.
 */
export type ClientMessage =
  | { type: 'message'; content: string; planningMode: boolean; yoloMode: boolean }
  | { type: 'tool_response'; toolCallId: string; response: string | boolean }
  | { type: 'cancel' }

/**
 * Messages sent from server to client over WebSocket.
 */
export type ServerMessage =
  | { type: 'chunk'; content: string }
  | { type: 'tool_started'; toolCall: ToolCallInfo }
  | { type: 'tool_complete'; toolCallId: string; result: ToolCallResult }
  | { type: 'blocking'; toolCallId: string; uiData: BlockingToolUI }
  | { type: 'tasks_updated'; tasks: Task[] }
  | { type: 'complete'; waitingForInput: boolean }
  | { type: 'error'; message: string }
  | { type: 'iteration_started'; iterationIndex: number }

/**
 * Tool call information sent to clients.
 * Subset of ToolCallLog for the wire protocol.
 */
export interface ToolCallInfo {
  id: string
  name: string
  arguments: Record<string, unknown>
  blocking?: boolean
}

// ============================================================================
// Event Transport Interface
// ============================================================================

/**
 * Abstract transport layer for thought loop events.
 * Implementations handle the actual communication with clients.
 */
export interface EventTransport {
  /**
   * Sends a streaming content chunk to the client.
   */
  sendChunk(conversationId: string, chunk: string): void

  /**
   * Notifies the client that a tool execution has started.
   */
  sendToolStarted(conversationId: string, toolCall: ToolCallLog): void

  /**
   * Notifies the client that a tool execution has completed.
   */
  sendToolComplete(conversationId: string, toolCallId: string, result: ToolCallResult): void

  /**
   * Sends blocking tool UI data to the client.
   * The client should display a UI for user input.
   */
  sendBlocking(conversationId: string, toolCallId: string, uiData: BlockingToolUI): void

  /**
   * Notifies the client that the task list has been updated.
   */
  sendTasksUpdated(conversationId: string, tasks: Task[]): void

  /**
   * Notifies the client that the request has completed.
   */
  sendComplete(conversationId: string, waitingForInput: boolean): void

  /**
   * Sends an error message to the client.
   */
  sendError(conversationId: string, message: string): void

  /**
   * Notifies the client that a new iteration has started.
   */
  sendIterationStarted(conversationId: string, iterationIndex: number): void

  /**
   * Opens a file in the client editor (if supported).
   */
  sendOpenFile(filePath: string): void

  /**
   * Waits for a response from the client to a blocking tool.
   * Used by ask_user and request_task_approval tools.
   *
   * @returns The user's response (string for ask_user, boolean for approval)
   */
  waitForToolResponse(conversationId: string, toolCallId: string): Promise<string | boolean>

  /**
   * Waits for tool approval from the client.
   * Called when a non-safe tool needs user approval before execution.
   *
   * @returns true if approved, false if rejected
   */
  waitForToolApproval(conversationId: string, toolCallId: string): Promise<boolean>
}

// ============================================================================
// Conversation Info Types
// ============================================================================

/**
 * Information about a conversation, returned by API endpoints.
 */
export interface ConversationInfo {
  id: string
  workspaceFolders: string[]
  filebarId: string
  createdAt: number
  title?: string
}

/**
 * Request to create a new conversation.
 */
export interface CreateConversationRequest {
  workspaceFolders: string[]
  filebarId?: string
}
