/**
 * Provider Store
 *
 * File-based persistence for LLM provider configurations.
 * Stores providers in ~/.config/markus-the-editor/providers.json,
 * providing CRUD operations with API key masking for safe API responses.
 *
 * Providers allow multiple agents to share the same endpoint and API key
 * without duplicating configuration. Also supports model discovery via
 * the OpenAI-compatible GET /v1/models endpoint.
 */

import * as fs from 'fs/promises'
import { existsSync } from 'fs'
import * as path from 'path'
import * as os from 'os'
import { v4 as uuidv4 } from 'uuid'
import type {
  Provider,
  CreateProviderRequest,
  UpdateProviderRequest,
  ModelInfo
} from './types'

// ============================================================================
// File Path
// ============================================================================

/** Sentinel value for masked API keys in responses */
const API_KEY_MASK = '***'

/**
 * Gets the path to the providers.json persistence file.
 */
function getProvidersFilePath(): string {
  const configDir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  return path.join(configDir, 'markus-the-editor', 'providers.json')
}

// ============================================================================
// File I/O
// ============================================================================

/**
 * Reads all providers from disk.
 * Returns an empty record if the file doesn't exist yet.
 */
async function readProviders(): Promise<Record<string, Provider>> {
  const filePath = getProvidersFilePath()

  if (!existsSync(filePath)) {
    return {}
  }

  try {
    const content = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(content) as Record<string, Provider>
  } catch (error) {
    console.error('[ProviderStore] Error reading providers.json:', error)
    return {}
  }
}

/**
 * Writes all providers to disk.
 * Ensures the config directory exists before writing.
 */
async function writeProviders(providers: Record<string, Provider>): Promise<void> {
  const filePath = getProvidersFilePath()
  const dir = path.dirname(filePath)

  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(providers, null, 2), 'utf-8')
}

// ============================================================================
// API Key Handling
// ============================================================================

/**
 * Masks an API key for safe inclusion in API responses.
 */
function maskApiKey(key: string | undefined): string | undefined {
  if (!key) return undefined
  return API_KEY_MASK
}

/**
 * Preserves the existing API key when the client sends the masked sentinel value
 * or omits the field entirely. Only replaces the key when a new value is explicitly provided.
 */
function preserveApiKey(newKey: string | undefined, existingKey: string | undefined): string | undefined {
  if (newKey === undefined || newKey === API_KEY_MASK) {
    return existingKey
  }
  return newKey
}

/**
 * Returns a copy of the provider with the API key masked.
 */
function maskProvider(provider: Provider): Provider {
  return {
    ...provider,
    apiKey: maskApiKey(provider.apiKey)
  }
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validates the input for creating or updating a provider.
 * Returns an array of error messages (empty if valid).
 */
function validateProviderInput(
  input: CreateProviderRequest | UpdateProviderRequest,
  isCreate: boolean
): string[] {
  const errors: string[] = []

  if (isCreate) {
    const create = input as CreateProviderRequest
    if (!create.name) errors.push('name is required')
    if (!create.endpoint) errors.push('endpoint is required')
  }

  if (input.name !== undefined && !input.name) errors.push('name must not be empty')
  if (input.endpoint !== undefined && !input.endpoint) errors.push('endpoint must not be empty')

  return errors
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Creates a new provider.
 */
export async function createProvider(input: CreateProviderRequest): Promise<Provider> {
  const errors = validateProviderInput(input, true)
  if (errors.length > 0) {
    throw new ProviderValidationError(errors)
  }

  const providers = await readProviders()
  const now = Date.now()

  const provider: Provider = {
    id: uuidv4(),
    name: input.name,
    endpoint: input.endpoint,
    apiKey: input.apiKey,
    defaultModel: input.defaultModel,
    createdAt: now,
    updatedAt: now
  }

  providers[provider.id] = provider
  await writeProviders(providers)

  console.log(`[ProviderStore] Created provider "${provider.name}" (${provider.id})`)
  return provider
}

/**
 * Gets a single provider by ID (unmasked, for internal use).
 */
export async function getProvider(id: string): Promise<Provider | undefined> {
  const providers = await readProviders()
  return providers[id]
}

/**
 * Lists all providers with API keys masked.
 */
export async function listProviders(): Promise<Provider[]> {
  const providers = await readProviders()
  return Object.values(providers).map(maskProvider)
}

/**
 * Lists all providers with full (unmasked) data, for internal resolution.
 */
export async function listProvidersUnmasked(): Promise<Provider[]> {
  const providers = await readProviders()
  return Object.values(providers)
}

/**
 * Updates an existing provider.
 */
export async function updateProvider(
  id: string,
  updates: UpdateProviderRequest
): Promise<Provider | undefined> {
  const errors = validateProviderInput(updates, false)
  if (errors.length > 0) {
    throw new ProviderValidationError(errors)
  }

  const providers = await readProviders()
  const existing = providers[id]
  if (!existing) return undefined

  const resolvedApiKey = preserveApiKey(updates.apiKey, existing.apiKey)

  const updated: Provider = {
    ...existing,
    ...updates,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
    apiKey: resolvedApiKey
  }

  providers[id] = updated
  await writeProviders(providers)

  console.log(`[ProviderStore] Updated provider "${updated.name}" (${id})`)
  return updated
}

/**
 * Deletes a provider by ID.
 */
export async function deleteProvider(id: string): Promise<boolean> {
  const providers = await readProviders()
  if (!providers[id]) return false

  const name = providers[id].name
  delete providers[id]
  await writeProviders(providers)

  console.log(`[ProviderStore] Deleted provider "${name}" (${id})`)
  return true
}

// ============================================================================
// Model Discovery
// ============================================================================

/** In-memory cache for model lists, keyed by provider ID */
const modelCache = new Map<string, { models: ModelInfo[]; fetchedAt: number }>()

/** Cache TTL: 30 seconds */
const MODEL_CACHE_TTL = 30_000

/**
 * Fetches available models from a provider's OpenAI-compatible /v1/models endpoint.
 * Results are cached for 30 seconds per provider.
 */
export async function fetchProviderModels(provider: Provider): Promise<ModelInfo[]> {
  // Check cache
  const cached = modelCache.get(provider.id)
  if (cached && Date.now() - cached.fetchedAt < MODEL_CACHE_TTL) {
    return cached.models
  }

  // Normalize endpoint: strip trailing /v1/chat/completions or /v1 suffix
  // to get the base URL, then append /v1/models
  let baseUrl = provider.endpoint.replace(/\/+$/, '')
  baseUrl = baseUrl.replace(/\/v1\/chat\/completions$/, '')
  baseUrl = baseUrl.replace(/\/v1$/, '')
  const modelsUrl = `${baseUrl}/v1/models`

  const headers: Record<string, string> = {
    'Accept': 'application/json'
  }
  if (provider.apiKey) {
    headers['Authorization'] = `Bearer ${provider.apiKey}`
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  try {
    const response = await fetch(modelsUrl, {
      headers,
      signal: controller.signal
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const data = await response.json() as { data?: Array<{ id: string; owned_by?: string }> }

    if (!data.data || !Array.isArray(data.data)) {
      throw new Error('Unexpected response format: missing data array')
    }

    const models: ModelInfo[] = data.data.map(m => ({
      id: m.id,
      owned_by: m.owned_by
    }))

    // Sort alphabetically by model ID
    models.sort((a, b) => a.id.localeCompare(b.id))

    // Cache the result
    modelCache.set(provider.id, { models, fetchedAt: Date.now() })

    return models
  } finally {
    clearTimeout(timeout)
  }
}

// ============================================================================
// Default Providers
// ============================================================================

/**
 * Seeds a default provider from the main LLM settings if no providers exist.
 * Called on server startup so there's always at least one provider available.
 */
export async function ensureDefaultProviders(llmSettings: {
  apiEndpoint: string
  apiKey: string
  model: string
}): Promise<void> {
  const existing = await readProviders()
  if (Object.keys(existing).length > 0) {
    console.log(`[ProviderStore] ${Object.keys(existing).length} providers already exist, skipping seed`)
    return
  }

  console.log('[ProviderStore] No providers found, seeding default from main LLM settings...')

  await createProvider({
    name: 'Default',
    endpoint: llmSettings.apiEndpoint,
    apiKey: llmSettings.apiKey,
    defaultModel: llmSettings.model
  })

  console.log('[ProviderStore] Seeded 1 default provider')
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Thrown when provider input fails validation.
 */
export class ProviderValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Validation failed: ${errors.join(', ')}`)
    this.name = 'ProviderValidationError'
  }
}
