/**
 * Provider Routes
 *
 * HTTP endpoints for LLM provider management:
 * - POST /providers - Create a new provider
 * - GET /providers - List all providers
 * - GET /providers/:id - Get a specific provider
 * - PUT /providers/:id - Update a provider
 * - DELETE /providers/:id - Delete a provider
 * - GET /providers/:id/models - Fetch models from the provider's API
 */

import { Express, Request, Response } from 'express'
import type { CreateProviderRequest, UpdateProviderRequest } from '../types'
import {
  createProvider,
  listProviders,
  getProvider,
  updateProvider,
  deleteProvider,
  fetchProviderModels,
  ProviderValidationError
} from '../providerStore'

/**
 * Sets up provider routes on the Express app.
 */
export function setupProviderRoutes(app: Express): void {
  /**
   * Create a new provider.
   *
   * Request body: CreateProviderRequest
   * Response: Provider (key masked)
   */
  app.post('/providers', async (req: Request, res: Response) => {
    try {
      const input = req.body as CreateProviderRequest
      const provider = await createProvider(input)

      // Mask API key in response
      const masked = { ...provider, apiKey: provider.apiKey ? '***' : undefined }
      res.status(201).json(masked)
    } catch (error) {
      if (error instanceof ProviderValidationError) {
        res.status(400).json({ error: 'Validation failed', details: error.errors })
        return
      }
      console.error('[Providers] Error creating provider:', error)
      res.status(500).json({ error: 'Failed to create provider' })
    }
  })

  /**
   * List all providers.
   *
   * Response: Provider[] (keys masked)
   */
  app.get('/providers', async (_req: Request, res: Response) => {
    try {
      const providers = await listProviders()
      res.json(providers)
    } catch (error) {
      console.error('[Providers] Error listing providers:', error)
      res.status(500).json({ error: 'Failed to list providers' })
    }
  })

  /**
   * Get a specific provider.
   *
   * Response: Provider (key masked)
   */
  app.get('/providers/:id', async (req: Request, res: Response) => {
    try {
      const provider = await getProvider(req.params.id)
      if (!provider) {
        res.status(404).json({ error: 'Provider not found' })
        return
      }

      // Mask API key in response
      const masked = { ...provider, apiKey: provider.apiKey ? '***' : undefined }
      res.json(masked)
    } catch (error) {
      console.error('[Providers] Error getting provider:', error)
      res.status(500).json({ error: 'Failed to get provider' })
    }
  })

  /**
   * Update a provider.
   *
   * Request body: UpdateProviderRequest
   * Response: Provider (key masked)
   */
  app.put('/providers/:id', async (req: Request, res: Response) => {
    try {
      const updates = req.body as UpdateProviderRequest
      const updated = await updateProvider(req.params.id, updates)

      if (!updated) {
        res.status(404).json({ error: 'Provider not found' })
        return
      }

      // Mask API key in response
      const masked = { ...updated, apiKey: updated.apiKey ? '***' : undefined }
      res.json(masked)
    } catch (error) {
      if (error instanceof ProviderValidationError) {
        res.status(400).json({ error: 'Validation failed', details: error.errors })
        return
      }
      console.error('[Providers] Error updating provider:', error)
      res.status(500).json({ error: 'Failed to update provider' })
    }
  })

  /**
   * Delete a provider.
   *
   * Response: { success: true }
   */
  app.delete('/providers/:id', async (req: Request, res: Response) => {
    try {
      const deleted = await deleteProvider(req.params.id)
      if (!deleted) {
        res.status(404).json({ error: 'Provider not found' })
        return
      }

      res.json({ success: true })
    } catch (error) {
      console.error('[Providers] Error deleting provider:', error)
      res.status(500).json({ error: 'Failed to delete provider' })
    }
  })

  /**
   * Fetch available models from a provider's upstream API.
   * Uses a 30-second in-memory cache to avoid hammering the upstream.
   *
   * Response: ModelInfo[]
   */
  app.get('/providers/:id/models', async (req: Request, res: Response) => {
    try {
      const provider = await getProvider(req.params.id)
      if (!provider) {
        res.status(404).json({ error: 'Provider not found' })
        return
      }

      const models = await fetchProviderModels(provider)
      res.json(models)
    } catch (error) {
      console.error('[Providers] Error fetching models:', error)
      const message = error instanceof Error ? error.message : 'Unknown error'
      res.status(502).json({ error: `Failed to fetch models: ${message}` })
    }
  })
}
