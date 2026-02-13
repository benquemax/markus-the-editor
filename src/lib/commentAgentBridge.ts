/**
 * Comment-to-Agent Event Bridge
 *
 * Provides a decoupled communication channel between the comment system
 * and the Markus agent chat using DOM CustomEvents. When a user @mentions
 * @markus in a comment, the highlighted text and comment are sent to the
 * agent as a formatted message.
 */

export interface CommentToAgentPayload {
  /** The text that was highlighted/commented */
  highlightedText: string
  /** The comment text (including @markus mention) */
  commentText: string
  /** Author of the comment */
  author: string
  /** File path if available */
  filePath?: string | null
}

const EVENT_NAME = 'comment-to-agent'

/**
 * Sends a comment to the agent chat panel.
 * Dispatched from the comment system when @markus is mentioned.
 */
export function sendCommentToAgent(payload: CommentToAgentPayload): void {
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: payload }))
}

/**
 * Subscribes to comment-to-agent events.
 * Used by the agent widget to receive @markus mentions.
 * Returns an unsubscribe function.
 */
export function onCommentToAgent(handler: (payload: CommentToAgentPayload) => void): () => void {
  const listener = (e: Event) => {
    handler((e as CustomEvent<CommentToAgentPayload>).detail)
  }
  window.addEventListener(EVENT_NAME, listener)
  return () => window.removeEventListener(EVENT_NAME, listener)
}
