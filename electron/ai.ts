/**
 * AI Merge Handler
 *
 * Provides AI-powered merging of conflicting text versions using
 * OpenAI-compatible APIs. This gives writers a user-friendly way
 * to combine two versions of their text without manual editing.
 */

import { IpcMain } from 'electron'
import Store from 'electron-store'

export interface AiMergeSettings {
  enabled: boolean
  apiEndpoint: string
  apiKey: string
  model: string
}

const DEFAULT_AI_SETTINGS: AiMergeSettings = {
  enabled: false,
  apiEndpoint: 'https://api.openai.com/v1/chat/completions',
  apiKey: '',
  model: 'gpt-4o-mini'
}

const MERGE_SYSTEM_PROMPT = `You are helping a writer merge two versions of their text.
Combine these versions into one coherent text that preserves the best of both.
Maintain the author's voice and style.
Do not add explanations or commentary.
Return ONLY the merged text, nothing else.`

export function setupAiHandlers(ipcMain: IpcMain, store: Store) {
  /**
   * Gets the current AI merge settings.
   */
  ipcMain.handle('ai:getSettings', () => {
    const settings = store.get('aiMerge') as AiMergeSettings | undefined
    return settings || DEFAULT_AI_SETTINGS
  })

  /**
   * Updates AI merge settings.
   */
  ipcMain.handle('ai:setSettings', (_, settings: Partial<AiMergeSettings>) => {
    const current = (store.get('aiMerge') as AiMergeSettings) || DEFAULT_AI_SETTINGS
    const updated = { ...current, ...settings }
    store.set('aiMerge', updated)
    return updated
  })

  /**
   * Tests the AI connection by making a simple request.
   */
  ipcMain.handle('ai:testConnection', async () => {
    const settings = (store.get('aiMerge') as AiMergeSettings) || DEFAULT_AI_SETTINGS

    if (!settings.apiKey) {
      return { success: false, error: 'API key not configured' }
    }

    try {
      const response = await fetch(settings.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.apiKey}`
        },
        body: JSON.stringify({
          model: settings.model,
          messages: [{ role: 'user', content: 'Say "OK" if you can hear me.' }],
          max_tokens: 10
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        return { success: false, error: `API error: ${response.status} - ${errorText}` }
      }

      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  /**
   * Merges two versions of text using AI.
   * Returns the merged result.
   */
  ipcMain.handle('ai:merge', async (_, localContent: string, remoteContent: string) => {
    const settings = (store.get('aiMerge') as AiMergeSettings) || DEFAULT_AI_SETTINGS

    if (!settings.apiKey) {
      return { success: false, error: 'API key not configured' }
    }

    try {
      const userPrompt = `Please merge these two versions of text:

VERSION A (local):
${localContent}

VERSION B (remote):
${remoteContent}

Merge them into one coherent text.`

      const response = await fetch(settings.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.apiKey}`
        },
        body: JSON.stringify({
          model: settings.model,
          messages: [
            { role: 'system', content: MERGE_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.3
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        return { success: false, error: `API error: ${response.status} - ${errorText}` }
      }

      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>
      }
      const merged = data.choices?.[0]?.message?.content

      if (!merged) {
        return { success: false, error: 'No response from AI' }
      }

      return { success: true, merged: merged.trim() }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })
}
