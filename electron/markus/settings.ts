/**
 * Markus Settings Manager
 *
 * Handles reading and writing Markus settings from YAML configuration.
 * Settings are stored at ~/.config/markus-the-editor/settings.yaml
 * following the XDG Base Directory specification.
 */

import { app } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import { existsSync } from 'fs'
import yaml from 'js-yaml'
import { MarkusSettings, DEFAULT_MARKUS_SETTINGS } from './types'

/**
 * Gets the config directory path following XDG spec.
 */
export function getConfigDir(): string {
  const configDir = process.env.XDG_CONFIG_HOME || path.join(app.getPath('home'), '.config')
  return path.join(configDir, 'markus-the-editor')
}

/**
 * Gets the path to the settings.yaml file.
 */
export function getSettingsPath(): string {
  return path.join(getConfigDir(), 'settings.yaml')
}

/**
 * Ensures the config directory exists.
 */
async function ensureConfigDir(): Promise<void> {
  const dir = getConfigDir()
  await fs.mkdir(dir, { recursive: true })
}

/**
 * Reads settings from YAML file, returning defaults if not found.
 */
export async function readSettings(): Promise<MarkusSettings> {
  const settingsPath = getSettingsPath()

  if (!existsSync(settingsPath)) {
    return { ...DEFAULT_MARKUS_SETTINGS }
  }

  try {
    const content = await fs.readFile(settingsPath, 'utf-8')
    const parsed = yaml.load(content) as Partial<MarkusSettings>

    // Merge with defaults to ensure all fields exist
    return {
      llm: {
        ...DEFAULT_MARKUS_SETTINGS.llm,
        ...parsed?.llm
      },
      search: {
        ...DEFAULT_MARKUS_SETTINGS.search,
        ...parsed?.search
      },
      defaultPlanningMode: parsed?.defaultPlanningMode ?? DEFAULT_MARKUS_SETTINGS.defaultPlanningMode,
      yoloMode: parsed?.yoloMode ?? DEFAULT_MARKUS_SETTINGS.yoloMode
    }
  } catch (error) {
    console.error('Failed to parse settings.yaml:', error)
    return { ...DEFAULT_MARKUS_SETTINGS }
  }
}

/**
 * Writes settings to YAML file.
 */
export async function writeSettings(settings: MarkusSettings): Promise<void> {
  await ensureConfigDir()
  const settingsPath = getSettingsPath()

  const yamlContent = yaml.dump(settings, {
    indent: 2,
    lineWidth: 120,
    quotingType: '"',
    forceQuotes: false
  })

  await fs.writeFile(settingsPath, yamlContent, 'utf-8')
}

/**
 * Updates specific settings fields without overwriting others.
 */
export async function updateSettings(updates: Partial<MarkusSettings>): Promise<MarkusSettings> {
  const current = await readSettings()

  const updated: MarkusSettings = {
    ...current,
    ...updates,
    llm: {
      ...current.llm,
      ...updates.llm
    },
    search: {
      ...current.search,
      ...updates.search
    }
  }

  await writeSettings(updated)
  return updated
}

/**
 * Creates a default settings file with comments if it doesn't exist.
 */
export async function ensureSettingsFile(): Promise<void> {
  await ensureConfigDir()
  const settingsPath = getSettingsPath()

  if (existsSync(settingsPath)) {
    return
  }

  // Create a settings file with helpful comments
  const defaultContent = `# Markus AI Agent Settings
# This file configures the Markus AI assistant in the editor.

# LLM Configuration
# Supports OpenAI, Anthropic, and OpenAI-compatible APIs (local models, etc.)
llm:
  # API endpoint URL
  # For OpenAI: https://api.openai.com/v1/chat/completions
  # For Anthropic: https://api.anthropic.com/v1/messages
  apiEndpoint: "https://api.openai.com/v1/chat/completions"
  # API key (keep this secret!)
  apiKey: ""
  # Model to use
  # OpenAI: gpt-4o-mini, gpt-4o, gpt-4-turbo
  # Anthropic: claude-3-5-sonnet-20241022, claude-3-opus-20240229
  model: "gpt-4o-mini"
  # Maximum tokens for response
  maxTokens: 4096
  # Temperature (0-2 for OpenAI, 0-1 for Anthropic)
  temperature: 0.7

# Web Search Configuration
search:
  # SearxNG instance URL (optional, for privacy-respecting search)
  # searxngUrl: "https://your-searxng-instance.com"
  # Use DuckDuckGo AI for quick answers
  useDuckDuckGo: true

# Mode Settings
# Planning mode requires approval before executing tools
defaultPlanningMode: true
# YOLO mode executes all tools without approval (use with caution!)
yoloMode: false
`

  await fs.writeFile(settingsPath, defaultContent, 'utf-8')
}

/**
 * Validates that required settings are configured.
 */
export function validateSettings(settings: MarkusSettings): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!settings.llm.apiEndpoint) {
    errors.push('LLM API endpoint is not configured')
  }

  if (!settings.llm.apiKey) {
    errors.push('LLM API key is not configured')
  }

  if (!settings.llm.model) {
    errors.push('LLM model is not configured')
  }

  return {
    valid: errors.length === 0,
    errors
  }
}
