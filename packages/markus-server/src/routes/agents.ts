/**
 * Agent Definition Routes
 *
 * HTTP endpoints for agent definition management:
 * - POST /agents - Create a new agent definition
 * - GET /agents - List all agent definitions
 * - GET /agents/:id - Get a specific agent definition
 * - PUT /agents/:id - Update an agent definition
 * - DELETE /agents/:id - Delete an agent definition
 */

import { Express, Request, Response } from 'express'
import type { CreateAgentDefinitionRequest, UpdateAgentDefinitionRequest } from '../types'
import {
  createAgentDefinition,
  listAgentDefinitions,
  getAgentDefinition,
  updateAgentDefinition,
  deleteAgentDefinition,
  ValidationError
} from '../agentDefinitionStore'
import { TOOL_PRESETS, DEFAULT_TOOLS } from '../core/index'

/**
 * Sets up agent definition routes on the Express app.
 */
export function setupAgentRoutes(app: Express): void {
  /**
   * Get available tool presets.
   * Returns a map of preset name → tool name array.
   *
   * Registered before parameterized routes so "/agents/tool-presets"
   * isn't captured by "/agents/:id".
   */
  app.get('/agents/tool-presets', (_req: Request, res: Response) => {
    res.json({
      presets: TOOL_PRESETS,
      default: DEFAULT_TOOLS
    })
  })

  /**
   * Create a new agent definition.
   *
   * Request body: CreateAgentDefinitionRequest
   * Response: AgentDefinition (key masked)
   */
  app.post('/agents', async (req: Request, res: Response) => {
    try {
      const input = req.body as CreateAgentDefinitionRequest
      const definition = await createAgentDefinition(input)

      // Mask API key in response
      const masked = { ...definition, apiKey: definition.apiKey ? '***' : undefined }
      res.status(201).json(masked)
    } catch (error) {
      if (error instanceof ValidationError) {
        res.status(400).json({ error: 'Validation failed', details: error.errors })
        return
      }
      console.error('[Agents] Error creating agent definition:', error)
      res.status(500).json({ error: 'Failed to create agent definition' })
    }
  })

  /**
   * List all agent definitions.
   *
   * Response: AgentDefinition[] (keys masked)
   */
  app.get('/agents', async (_req: Request, res: Response) => {
    try {
      const definitions = await listAgentDefinitions()
      res.json(definitions)
    } catch (error) {
      console.error('[Agents] Error listing agent definitions:', error)
      res.status(500).json({ error: 'Failed to list agent definitions' })
    }
  })

  /**
   * Get a specific agent definition.
   *
   * Response: AgentDefinition (key masked)
   */
  app.get('/agents/:id', async (req: Request, res: Response) => {
    try {
      const definition = await getAgentDefinition(req.params.id)
      if (!definition) {
        res.status(404).json({ error: 'Agent definition not found' })
        return
      }

      // Mask API key in response
      const masked = { ...definition, apiKey: definition.apiKey ? '***' : undefined }
      res.json(masked)
    } catch (error) {
      console.error('[Agents] Error getting agent definition:', error)
      res.status(500).json({ error: 'Failed to get agent definition' })
    }
  })

  /**
   * Update an agent definition.
   *
   * Request body: UpdateAgentDefinitionRequest
   * Response: AgentDefinition (key masked)
   */
  app.put('/agents/:id', async (req: Request, res: Response) => {
    try {
      const updates = req.body as UpdateAgentDefinitionRequest
      const updated = await updateAgentDefinition(req.params.id, updates)

      if (!updated) {
        res.status(404).json({ error: 'Agent definition not found' })
        return
      }

      // Mask API key in response
      const masked = { ...updated, apiKey: updated.apiKey ? '***' : undefined }
      res.json(masked)
    } catch (error) {
      if (error instanceof ValidationError) {
        res.status(400).json({ error: 'Validation failed', details: error.errors })
        return
      }
      console.error('[Agents] Error updating agent definition:', error)
      res.status(500).json({ error: 'Failed to update agent definition' })
    }
  })

  /**
   * Delete an agent definition.
   *
   * Response: { success: true }
   */
  app.delete('/agents/:id', async (req: Request, res: Response) => {
    try {
      const deleted = await deleteAgentDefinition(req.params.id)
      if (!deleted) {
        res.status(404).json({ error: 'Agent definition not found' })
        return
      }

      res.json({ success: true })
    } catch (error) {
      console.error('[Agents] Error deleting agent definition:', error)
      res.status(500).json({ error: 'Failed to delete agent definition' })
    }
  })
}
