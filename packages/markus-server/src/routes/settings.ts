/**
 * Settings Routes
 *
 * HTTP endpoints for settings management:
 * - GET /settings - Get current settings
 * - PUT /settings - Update settings
 */

import { Express, Request, Response } from 'express'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import * as yaml from 'js-yaml'
import type { MarkusSettings } from '../types'

/**
 * Default settings used when no config file exists.
 */
const DEFAULT_SETTINGS: MarkusSettings = {
  llm: {
    apiEndpoint: 'https://api.openai.com/v1/chat/completions',
    apiKey: '',
    model: 'gpt-4o-mini',
    maxTokens: 4096,
    temperature: 0.7
  },
  search: {
    useDuckDuckGo: true
  },
  defaultPlanningMode: true,
  yoloMode: false
}

/**
 * Gets the settings file path.
 * Uses ~/.config/markus-the-editor/settings.yaml by default.
 */
function getSettingsPath(): string {
  const configDir = path.join(os.homedir(), '.config', 'markus-the-editor')
  return path.join(configDir, 'settings.yaml')
}

/**
 * Reads settings from the YAML file.
 */
async function readSettings(): Promise<MarkusSettings> {
  const settingsPath = getSettingsPath()

  try {
    const content = await fs.readFile(settingsPath, 'utf-8')
    const parsed = yaml.load(content) as Partial<MarkusSettings>

    // Merge with defaults to ensure all fields exist
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      llm: { ...DEFAULT_SETTINGS.llm, ...parsed.llm },
      search: { ...DEFAULT_SETTINGS.search, ...parsed.search }
    }
  } catch (error) {
    // Return defaults if file doesn't exist or is invalid
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return DEFAULT_SETTINGS
    }
    console.error('[Settings] Error reading settings:', error)
    return DEFAULT_SETTINGS
  }
}

/**
 * Writes settings to the YAML file.
 */
async function writeSettings(settings: MarkusSettings): Promise<void> {
  const settingsPath = getSettingsPath()
  const configDir = path.dirname(settingsPath)

  // Ensure config directory exists
  await fs.mkdir(configDir, { recursive: true })

  const content = yaml.dump(settings, {
    indent: 2,
    lineWidth: 120,
    noRefs: true
  })

  await fs.writeFile(settingsPath, content, 'utf-8')
}

/**
 * Validates settings and returns any errors.
 */
function validateSettings(settings: MarkusSettings): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!settings.llm.apiEndpoint) {
    errors.push('LLM API endpoint is required')
  }

  if (!settings.llm.apiKey) {
    errors.push('LLM API key is required')
  }

  if (!settings.llm.model) {
    errors.push('LLM model is required')
  }

  return {
    valid: errors.length === 0,
    errors
  }
}

/**
 * Sets up settings routes on the Express app.
 */
export function setupSettingsRoutes(app: Express): void {
  /**
   * Get current settings.
   *
   * Response: MarkusSettings (with apiKey masked)
   */
  app.get('/settings', async (_req: Request, res: Response) => {
    try {
      const settings = await readSettings()

      // Mask the API key for security
      const masked = {
        ...settings,
        llm: {
          ...settings.llm,
          apiKey: settings.llm.apiKey ? '***' : ''
        }
      }

      res.json(masked)
    } catch (error) {
      console.error('[Settings] Error reading settings:', error)
      res.status(500).json({ error: 'Failed to read settings' })
    }
  })

  /**
   * Update settings.
   *
   * Request body: Partial<MarkusSettings>
   * Response: { success: true }
   */
  app.put('/settings', async (req: Request, res: Response) => {
    try {
      const current = await readSettings()
      const updates = req.body as Partial<MarkusSettings>

      // Merge settings
      const updated: MarkusSettings = {
        ...current,
        ...updates,
        llm: { ...current.llm, ...updates.llm },
        search: { ...current.search, ...updates.search }
      }

      // If apiKey is '***', keep the current key
      if (updated.llm.apiKey === '***') {
        updated.llm.apiKey = current.llm.apiKey
      }

      // Validate before saving
      const validation = validateSettings(updated)
      if (!validation.valid) {
        res.status(400).json({
          error: 'Invalid settings',
          details: validation.errors
        })
        return
      }

      await writeSettings(updated)

      res.json({ success: true })
    } catch (error) {
      console.error('[Settings] Error updating settings:', error)
      res.status(500).json({ error: 'Failed to update settings' })
    }
  })

  /**
   * Validate current settings.
   *
   * Response: { valid: boolean, errors: string[] }
   */
  app.get('/settings/validate', async (_req: Request, res: Response) => {
    try {
      const settings = await readSettings()
      const validation = validateSettings(settings)
      res.json(validation)
    } catch (error) {
      console.error('[Settings] Error validating settings:', error)
      res.status(500).json({ error: 'Failed to validate settings' })
    }
  })
}
