/**
 * Transport Bridge Hook
 *
 * Maps Claude Agent SDK events to WebSocket messages that clients
 * (Markus UI, web GUIs, etc.) can consume. Converts the SDK's
 * async generator messages into the EventTransport format used
 * by Markus's existing transport layer.
 */

import type { ServerMessage } from '../../transport/types'

/**
 * Callback that sends a transport message to connected clients.
 * Typically this writes to a WebSocket connection.
 */
export type TransportSender = (message: ServerMessage) => void

/**
 * Processes an SDK message and emits the appropriate transport event.
 * Call this for each message yielded by the SDK query generator.
 */
export function handleSdkMessage(
  msg: { type: string; [key: string]: unknown },
  send: TransportSender
): void {
  switch (msg.type) {
    case 'assistant': {
      // Full assistant message — extract text content
      const message = msg.message as { content?: Array<{ type: string; text?: string }> }
      const text = message?.content
        ?.filter((b: { type: string }) => b.type === 'text')
        ?.map((b: { text?: string }) => b.text || '')
        ?.join('') || ''
      if (text) {
        send({ type: 'chunk', content: text })
      }
      break
    }

    case 'partial': {
      // Streaming partial message — emit as chunks
      const partial = msg as { text?: string }
      if (partial.text) {
        send({ type: 'chunk', content: partial.text })
      }
      break
    }

    case 'tool_progress': {
      // Tool execution in progress
      const toolName = (msg.toolName as string) || 'unknown'
      send({ type: 'tool_started', toolName })
      break
    }

    case 'result': {
      const subtype = msg.subtype as string
      if (subtype === 'success') {
        send({ type: 'complete', result: msg.result as string })
      } else if (subtype === 'error') {
        send({ type: 'error', message: (msg.error as string) || 'Unknown error' })
      }
      break
    }

    case 'system': {
      // System messages (e.g. tool output, notifications)
      const content = (msg.message as string) || ''
      if (content) {
        send({ type: 'chunk', content: `\n[System: ${content}]\n` })
      }
      break
    }
  }
}
