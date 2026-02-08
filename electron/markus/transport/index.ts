/**
 * Transport Module
 *
 * Exports the transport abstraction layer for the Markus thought loop.
 * This module allows the same core logic to work with different
 * communication mechanisms (IPC, WebSocket, etc.).
 */

export type {
  EventTransport,
  ClientMessage,
  ServerMessage,
  ToolCallInfo,
  ConversationInfo,
  CreateConversationRequest
} from './types'

export { IPCTransport, createIPCTransport } from './ipc'
