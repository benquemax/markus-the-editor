/**
 * Standalone Settings Loader
 *
 * Reads Markus settings without Electron dependencies.
 * Uses the same config file location as the Electron app.
 */

import * as fs from 'fs/promises'
import { existsSync } from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as yaml from 'js-yaml'
import type { MarkusSettings, LLMSettings, SearchSettings } from './types'

/**
 * Extended settings type that includes all agent configuration.
 * This matches the full MarkusSettings from the Electron app.
 */
export interface FullMarkusSettings extends MarkusSettings {
  agents?: {
    defaults?: AgentSettings
    orchestrator?: AgentSettings
    editor?: AgentSettings
    research?: AgentSettings
    critique?: AgentSettings
    style?: AgentSettings
    creative?: AgentSettings
  }
  rag?: {
    enabled: boolean
    embeddings?: {
      provider: string
      model: string
    }
    chunking?: {
      maxChunkSize: number
      overlap: number
    }
  }
  modelPresets?: Record<string, {
    name: string
    endpoint: string
    model: string
  }>
}

export interface AgentSettings {
  model?: string
  endpoint?: string
  apiKey?: string
  maxTokens?: number
  temperature?: number
  timeout?: number
}

/**
 * Default settings used when no config file exists.
 */
export const DEFAULT_SETTINGS: FullMarkusSettings = {
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
  yoloMode: false,
  rag: {
    enabled: true,
    embeddings: {
      provider: 'local',
      model: 'all-MiniLM-L6-v2'
    },
    chunking: {
      maxChunkSize: 512,
      overlap: 50
    }
  }
}

/**
 * Gets the config directory path following XDG spec.
 * Same location as the Electron app uses.
 */
export function getConfigDir(): string {
  const configDir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  return path.join(configDir, 'markus-the-editor')
}

/**
 * Gets the path to the settings.yaml file.
 */
export function getSettingsPath(): string {
  return path.join(getConfigDir(), 'settings.yaml')
}

/**
 * Gets the conversations directory path.
 */
export function getConversationsDir(): string {
  return path.join(getConfigDir(), 'conversations')
}

/**
 * Reads settings from YAML file, returning defaults if not found.
 */
export async function readSettings(): Promise<FullMarkusSettings> {
  const settingsPath = getSettingsPath()

  if (!existsSync(settingsPath)) {
    console.log('[Settings] No settings file found, using defaults')
    return { ...DEFAULT_SETTINGS }
  }

  try {
    const content = await fs.readFile(settingsPath, 'utf-8')
    const parsed = yaml.load(content) as Partial<FullMarkusSettings>

    // Merge with defaults to ensure all fields exist
    const settings: FullMarkusSettings = {
      llm: {
        ...DEFAULT_SETTINGS.llm,
        ...parsed?.llm
      },
      search: {
        ...DEFAULT_SETTINGS.search,
        ...parsed?.search
      },
      defaultPlanningMode: parsed?.defaultPlanningMode ?? DEFAULT_SETTINGS.defaultPlanningMode,
      yoloMode: parsed?.yoloMode ?? DEFAULT_SETTINGS.yoloMode,
      agents: parsed?.agents,
      rag: parsed?.rag ? {
        ...DEFAULT_SETTINGS.rag,
        ...parsed.rag
      } : DEFAULT_SETTINGS.rag,
      modelPresets: parsed?.modelPresets
    }

    console.log('[Settings] Loaded settings from', settingsPath)
    return settings
  } catch (error) {
    console.error('[Settings] Failed to parse settings.yaml:', error)
    return { ...DEFAULT_SETTINGS }
  }
}

/**
 * Validates that required settings are configured.
 */
export function validateSettings(settings: FullMarkusSettings): { valid: boolean; errors: string[] } {
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

/**
 * Ensures the config and conversations directories exist.
 */
export async function ensureDirectories(): Promise<void> {
  await fs.mkdir(getConfigDir(), { recursive: true })
  await fs.mkdir(getConversationsDir(), { recursive: true })
}
