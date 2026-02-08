/**
 * Conversation Routes
 *
 * HTTP endpoints for conversation management:
 * - POST /conversations - Create a new conversation
 * - GET /conversations - List all conversations
 * - GET /conversations/:id - Get a specific conversation
 * - DELETE /conversations/:id - Delete a conversation
 * - POST /conversations/:id/cancel - Cancel an active request
 */

import { Express, Request, Response } from 'express'
import type { ConversationManager } from '../conversationManager'
import type { CreateConversationRequest } from '../types'

/**
 * Sets up conversation routes on the Express app.
 */
export function setupConversationRoutes(
  app: Express,
  conversationManager: ConversationManager
): void {
  /**
   * Create a new conversation.
   *
   * Request body:
   * - workspaceFolders: string[] (required) - Paths to workspace folders
   * - filebarId: string (optional) - Custom filebar ID for grouping
   *
   * Response:
   * - id: string - Conversation ID
   * - workspaceFolders: string[]
   * - filebarId: string
   * - createdAt: number
   */
  app.post('/conversations', (req: Request, res: Response) => {
    const body = req.body as Partial<CreateConversationRequest>

    // Validate workspaceFolders
    if (!body.workspaceFolders || !Array.isArray(body.workspaceFolders)) {
      res.status(400).json({
        error: 'workspaceFolders is required and must be an array of paths'
      })
      return
    }

    if (body.workspaceFolders.length === 0) {
      res.status(400).json({
        error: 'workspaceFolders must contain at least one path'
      })
      return
    }

    // Validate each path is a string
    for (const folder of body.workspaceFolders) {
      if (typeof folder !== 'string') {
        res.status(400).json({
          error: 'workspaceFolders must contain only string paths'
        })
        return
      }
    }

    try {
      const conversation = conversationManager.create({
        workspaceFolders: body.workspaceFolders,
        filebarId: body.filebarId
      })

      res.status(201).json(conversation)
    } catch (error) {
      console.error('[Conversations] Error creating conversation:', error)
      res.status(500).json({ error: 'Failed to create conversation' })
    }
  })

  /**
   * List all conversations.
   *
   * Response: ConversationInfo[]
   */
  app.get('/conversations', (_req: Request, res: Response) => {
    try {
      const conversations = conversationManager.list()
      res.json(conversations)
    } catch (error) {
      console.error('[Conversations] Error listing conversations:', error)
      res.status(500).json({ error: 'Failed to list conversations' })
    }
  })

  /**
   * Get a specific conversation.
   *
   * Response: ConversationInfo
   */
  app.get('/conversations/:id', (req: Request, res: Response) => {
    const { id } = req.params

    const conversation = conversationManager.get(id)
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' })
      return
    }

    res.json(conversation)
  })

  /**
   * Delete a conversation.
   *
   * Response: { success: true }
   */
  app.delete('/conversations/:id', (req: Request, res: Response) => {
    const { id } = req.params

    const deleted = conversationManager.delete(id)
    if (!deleted) {
      res.status(404).json({ error: 'Conversation not found' })
      return
    }

    res.json({ success: true })
  })

  /**
   * Cancel an active request for a conversation.
   *
   * Response: { success: true }
   */
  app.post('/conversations/:id/cancel', (req: Request, res: Response) => {
    const { id } = req.params

    const conversation = conversationManager.get(id)
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' })
      return
    }

    const cancelled = conversationManager.cancelRequest(id)
    if (!cancelled) {
      res.status(400).json({ error: 'No active request to cancel' })
      return
    }

    res.json({ success: true })
  })

  /**
   * Update conversation metadata.
   *
   * Request body:
   * - title: string (optional) - Conversation title
   *
   * Response: ConversationInfo
   */
  app.patch('/conversations/:id', (req: Request, res: Response) => {
    const { id } = req.params
    const { title } = req.body

    const updated = conversationManager.update(id, { title })
    if (!updated) {
      res.status(404).json({ error: 'Conversation not found' })
      return
    }

    res.json(updated)
  })
}
