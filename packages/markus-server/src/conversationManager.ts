/**
 * Conversation Manager
 *
 * Manages active conversations for the server.
 * Handles conversation lifecycle, workspace context, and state.
 */

import { v4 as uuidv4 } from 'uuid'
import type { AgentDefinition, ConversationInfo, CreateConversationRequest } from './types'

/**
 * In-memory storage for active conversations.
 * In production, this could be backed by a database.
 */
interface ConversationState {
  info: ConversationInfo
  /** Abort controller for cancelling active requests */
  abortController?: AbortController
  /** Whether a request is currently processing */
  isProcessing: boolean
  /** Planning mode setting for this conversation */
  planningMode: boolean
  /** YOLO mode setting for this conversation */
  yoloMode: boolean
  /** Resolved agent definitions for this conversation (from API-defined agents) */
  agentDefinitions?: AgentDefinition[]
}

/**
 * Generates a filebarId from workspace folders.
 * This is a hash of the sorted folder paths for grouping conversations.
 */
function getFilebarId(workspaceFolders: string[]): string {
  const sorted = [...workspaceFolders].sort()
  const combined = sorted.join('|')
  // Simple hash for now - could use crypto.createHash('sha256') for production
  let hash = 0
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash).toString(36)
}

/**
 * Manages conversation state and lifecycle.
 */
export class ConversationManager {
  private conversations = new Map<string, ConversationState>()

  /**
   * Creates a new conversation with the given workspace folders.
   */
  create(request: CreateConversationRequest): ConversationInfo {
    const id = uuidv4()
    const filebarId = request.filebarId || getFilebarId(request.workspaceFolders)
    const now = Date.now()

    const info: ConversationInfo = {
      id,
      workspaceFolders: request.workspaceFolders,
      filebarId,
      createdAt: now,
      agentIds: request.agentIds
    }

    this.conversations.set(id, {
      info,
      isProcessing: false,
      planningMode: true,
      yoloMode: false
    })

    console.log(`[ConversationManager] Created conversation ${id} with folders:`, request.workspaceFolders)

    return info
  }

  /**
   * Gets a conversation by ID.
   */
  get(id: string): ConversationInfo | undefined {
    return this.conversations.get(id)?.info
  }

  /**
   * Lists all active conversations.
   */
  list(): ConversationInfo[] {
    return Array.from(this.conversations.values()).map(state => state.info)
  }

  /**
   * Deletes a conversation.
   */
  delete(id: string): boolean {
    const state = this.conversations.get(id)
    if (!state) {
      return false
    }

    // Cancel any active request
    if (state.abortController) {
      state.abortController.abort()
    }

    this.conversations.delete(id)
    console.log(`[ConversationManager] Deleted conversation ${id}`)
    return true
  }

  /**
   * Starts processing a request for a conversation.
   * Returns an abort controller for cancellation.
   */
  startProcessing(id: string): AbortController | null {
    const state = this.conversations.get(id)
    if (!state) {
      return null
    }

    // Cancel any existing request
    if (state.abortController) {
      state.abortController.abort()
    }

    const abortController = new AbortController()
    state.abortController = abortController
    state.isProcessing = true

    return abortController
  }

  /**
   * Marks a conversation as finished processing.
   */
  finishProcessing(id: string): void {
    const state = this.conversations.get(id)
    if (state) {
      state.abortController = undefined
      state.isProcessing = false
    }
  }

  /**
   * Cancels any active request for a conversation.
   */
  cancelRequest(id: string): boolean {
    const state = this.conversations.get(id)
    if (!state || !state.abortController) {
      return false
    }

    state.abortController.abort()
    state.abortController = undefined
    state.isProcessing = false
    return true
  }

  /**
   * Checks if a conversation is currently processing.
   */
  isProcessing(id: string): boolean {
    return this.conversations.get(id)?.isProcessing ?? false
  }

  /**
   * Updates conversation metadata (e.g., title).
   */
  update(id: string, updates: Partial<ConversationInfo>): ConversationInfo | undefined {
    const state = this.conversations.get(id)
    if (!state) {
      return undefined
    }

    // Only allow updating specific fields
    if (updates.title !== undefined) {
      state.info.title = updates.title
    }

    return state.info
  }

  /**
   * Updates mode settings for a conversation.
   */
  setModes(id: string, planningMode: boolean, yoloMode: boolean): void {
    const state = this.conversations.get(id)
    if (state) {
      state.planningMode = planningMode
      state.yoloMode = yoloMode
    }
  }

  /**
   * Gets mode settings for a conversation.
   */
  getModes(id: string): { planningMode: boolean; yoloMode: boolean } | undefined {
    const state = this.conversations.get(id)
    if (!state) {
      return undefined
    }
    return {
      planningMode: state.planningMode,
      yoloMode: state.yoloMode
    }
  }

  /**
   * Stores resolved agent definitions for a conversation.
   * Called after resolving agentIds during conversation creation.
   */
  setAgentDefinitions(id: string, definitions: AgentDefinition[]): void {
    const state = this.conversations.get(id)
    if (state) {
      state.agentDefinitions = definitions
    }
  }

  /**
   * Gets the resolved agent definitions for a conversation.
   */
  getAgentDefinitions(id: string): AgentDefinition[] | undefined {
    return this.conversations.get(id)?.agentDefinitions
  }
}
