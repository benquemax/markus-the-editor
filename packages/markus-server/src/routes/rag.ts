/**
 * RAG Routes
 *
 * HTTP endpoints for RAG (Retrieval-Augmented Generation) operations:
 * - POST /rag/search - Semantic search across indexed workspace files
 * - GET /rag/status/:conversationId - Get indexing status for a conversation
 * - POST /rag/reindex/:conversationId - Trigger workspace re-indexing
 */

import { Express, Request, Response } from 'express'
import {
  searchRAG,
  getRAGIndexStatus,
  reindexWorkspace,
  getConversationIndexManager
} from '../core/index'
import { ConversationManager } from '../conversationManager'

/**
 * Sets up RAG routes on the Express app.
 */
export function setupRAGRoutes(app: Express, conversationManager: ConversationManager): void {
  /**
   * Semantic search across indexed workspace files.
   *
   * Request body: { query: string, conversationId?: string, limit?: number, minScore?: number }
   * Response: Array of search results with file path, content, score, and line numbers.
   */
  app.post('/rag/search', async (req: Request, res: Response) => {
    try {
      const { query, conversationId, limit } = req.body as {
        query?: string
        conversationId?: string
        limit?: number
      }

      if (!query || typeof query !== 'string') {
        res.status(400).json({ error: 'query is required and must be a string' })
        return
      }

      const results = await searchRAG(query, limit ?? 10, conversationId)
      res.json(results)
    } catch (error) {
      console.error('[RAG] Search error:', error)
      res.status(500).json({ error: 'Failed to perform RAG search' })
    }
  })

  /**
   * Get indexing status for a conversation's workspace.
   *
   * Falls back to global RAG status if no per-conversation index exists.
   */
  app.get('/rag/status/:conversationId', (req: Request, res: Response) => {
    try {
      const { conversationId } = req.params

      // Verify conversation exists
      const conversation = conversationManager.get(conversationId)
      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' })
        return
      }

      // Try per-conversation index first, fall back to global
      const convIndexManager = getConversationIndexManager(conversationId)
      if (convIndexManager) {
        res.json(convIndexManager.getStatus())
        return
      }

      // Fall back to global index status
      const globalStatus = getRAGIndexStatus()
      if (globalStatus) {
        res.json(globalStatus)
        return
      }

      res.json({
        indexing: false,
        totalFiles: 0,
        indexedFiles: 0,
        totalChunks: 0,
        lastUpdated: null,
        error: 'RAG indexing is not enabled'
      })
    } catch (error) {
      console.error('[RAG] Status error:', error)
      res.status(500).json({ error: 'Failed to get RAG status' })
    }
  })

  /**
   * Trigger re-indexing for a conversation's workspace.
   * Returns immediately; indexing runs in the background.
   */
  app.post('/rag/reindex/:conversationId', async (req: Request, res: Response) => {
    try {
      const { conversationId } = req.params

      // Verify conversation exists
      const conversation = conversationManager.get(conversationId)
      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' })
        return
      }

      // Try per-conversation index first
      const convIndexManager = getConversationIndexManager(conversationId)
      if (convIndexManager) {
        // Fire and forget — indexing runs in background
        convIndexManager.indexWorkspace().catch((err: unknown) => {
          console.error(`[RAG] Reindex error (conv ${conversationId}):`, err)
        })
        res.json({ success: true, message: 'Re-indexing started' })
        return
      }

      // Fall back to global re-index
      reindexWorkspace().catch((err: unknown) => {
        console.error('[RAG] Global reindex error:', err)
      })
      res.json({ success: true, message: 'Global re-indexing started' })
    } catch (error) {
      console.error('[RAG] Reindex error:', error)
      res.status(500).json({ error: 'Failed to trigger re-indexing' })
    }
  })
}
