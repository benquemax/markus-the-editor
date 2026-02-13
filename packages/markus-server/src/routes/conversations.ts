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
import { getAgentDefinition, resolveAgentDefinition } from '../agentDefinitionStore'
import { listProvidersUnmasked } from '../providerStore'
import { readSettings } from '../settings'

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
   * - workspaceId: string (optional) - Custom workspace ID for grouping
   *
   * Response:
   * - id: string - Conversation ID
   * - workspaceFolders: string[]
   * - workspaceId: string
   * - createdAt: number
   */
  app.post('/conversations', async (req: Request, res: Response) => {
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
      // Resolve agent definitions if agentIds provided
      if (body.agentIds && Array.isArray(body.agentIds) && body.agentIds.length > 0) {
        const rawDefinitions = []
        for (const agentId of body.agentIds) {
          const definition = await getAgentDefinition(agentId)
          if (!definition) {
            res.status(400).json({
              error: `Agent definition not found: ${agentId}`
            })
            return
          }
          rawDefinitions.push(definition)
        }

        // Resolve endpoint/apiKey for each agent from provider or main settings
        const providers = await listProvidersUnmasked()
        const settings = await readSettings()
        const mainLlm = {
          endpoint: settings.llm.apiEndpoint,
          apiKey: settings.llm.apiKey,
          model: settings.llm.model
        }
        const resolvedDefinitions = rawDefinitions.map(d =>
          resolveAgentDefinition(d, providers, mainLlm)
        )

        const conversation = conversationManager.create({
          workspaceFolders: body.workspaceFolders,
          workspaceId: body.workspaceId,
          agentIds: body.agentIds
        })

        // Store the fully resolved definitions on the conversation
        conversationManager.setAgentDefinitions(conversation.id, resolvedDefinitions)

        res.status(201).json(conversation)
      } else {
        const conversation = conversationManager.create({
          workspaceFolders: body.workspaceFolders,
          workspaceId: body.workspaceId
        })

        res.status(201).json(conversation)
      }
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
