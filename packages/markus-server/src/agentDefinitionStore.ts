/**
 * Agent Definition Store
 *
 * File-based persistence for agent definitions.
 * Stores agent definitions in ~/.config/markus-the-editor/agents.json,
 * providing CRUD operations with API key masking for safe API responses.
 */

import * as fs from 'fs/promises'
import { existsSync } from 'fs'
import * as path from 'path'
import * as os from 'os'
import { v4 as uuidv4 } from 'uuid'
import type {
  AgentDefinition,
  CreateAgentDefinitionRequest,
  UpdateAgentDefinitionRequest
} from './types'

// ============================================================================
// File Path
// ============================================================================

/** Sentinel value for masked API keys in responses */
const API_KEY_MASK = '***'

/**
 * Gets the path to the agents.json persistence file.
 */
function getAgentsFilePath(): string {
  const configDir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  return path.join(configDir, 'markus-the-editor', 'agents.json')
}

// ============================================================================
// File I/O
// ============================================================================

/**
 * Reads all agent definitions from disk.
 * Returns an empty record if the file doesn't exist yet.
 */
async function readAgentDefinitions(): Promise<Record<string, AgentDefinition>> {
  const filePath = getAgentsFilePath()

  if (!existsSync(filePath)) {
    return {}
  }

  try {
    const content = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(content) as Record<string, AgentDefinition>
  } catch (error) {
    console.error('[AgentDefinitionStore] Error reading agents.json:', error)
    return {}
  }
}

/**
 * Writes all agent definitions to disk.
 * Ensures the config directory exists before writing.
 */
async function writeAgentDefinitions(agents: Record<string, AgentDefinition>): Promise<void> {
  const filePath = getAgentsFilePath()
  const dir = path.dirname(filePath)

  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(agents, null, 2), 'utf-8')
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
 * Returns a copy of the agent definition with the API key masked.
 */
function maskDefinition(agent: AgentDefinition): AgentDefinition {
  return {
    ...agent,
    apiKey: maskApiKey(agent.apiKey)
  }
}

// ============================================================================
// Validation
// ============================================================================

/** Slug format: lowercase letters, numbers, and hyphens */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Validates the input for creating or updating an agent definition.
 * Returns an array of error messages (empty if valid).
 */
function validateAgentInput(
  input: CreateAgentDefinitionRequest | UpdateAgentDefinitionRequest,
  isCreate: boolean
): string[] {
  const errors: string[] = []

  // Required fields for creation
  if (isCreate) {
    const create = input as CreateAgentDefinitionRequest
    if (!create.slug) errors.push('slug is required')
    if (!create.name) errors.push('name is required')
    if (!create.roleDefinition) errors.push('roleDefinition is required')
    if (!create.whenToUse) errors.push('whenToUse is required')
    if (!create.description) errors.push('description is required')
    if (!create.model) errors.push('model is required')
    if (!create.endpoint) errors.push('endpoint is required')
  }

  // Validate slug format when provided
  if (input.slug !== undefined) {
    if (typeof input.slug !== 'string' || !SLUG_PATTERN.test(input.slug)) {
      errors.push('slug must be lowercase letters, numbers, and hyphens (e.g. "research-analyst")')
    }
  }

  // Validate non-empty strings when provided
  if (input.name !== undefined && !input.name) errors.push('name must not be empty')
  if (input.roleDefinition !== undefined && !input.roleDefinition) errors.push('roleDefinition must not be empty')
  if (input.model !== undefined && !input.model) errors.push('model must not be empty')
  if (input.endpoint !== undefined && !input.endpoint) errors.push('endpoint must not be empty')

  // Validate numeric ranges
  if (input.maxTokens !== undefined && (typeof input.maxTokens !== 'number' || input.maxTokens <= 0)) {
    errors.push('maxTokens must be a positive number')
  }
  if (input.temperature !== undefined && (typeof input.temperature !== 'number' || input.temperature < 0 || input.temperature > 2)) {
    errors.push('temperature must be a number between 0 and 2')
  }

  // Validate tools array when provided
  if (input.tools !== undefined) {
    if (!Array.isArray(input.tools)) {
      errors.push('tools must be an array of strings')
    } else if (input.tools.some(t => typeof t !== 'string' || t.length === 0)) {
      errors.push('each tool in tools must be a non-empty string')
    }
  }

  return errors
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Creates a new agent definition.
 * Generates UUID and sets timestamps automatically.
 */
export async function createAgentDefinition(
  input: CreateAgentDefinitionRequest
): Promise<AgentDefinition> {
  const errors = validateAgentInput(input, true)
  if (errors.length > 0) {
    throw new ValidationError(errors)
  }

  const agents = await readAgentDefinitions()
  const now = Date.now()

  const definition: AgentDefinition = {
    id: uuidv4(),
    slug: input.slug,
    name: input.name,
    roleDefinition: input.roleDefinition,
    whenToUse: input.whenToUse,
    description: input.description,
    customInstructions: input.customInstructions,
    model: input.model,
    endpoint: input.endpoint,
    apiKey: input.apiKey,
    maxTokens: input.maxTokens ?? 4096,
    temperature: input.temperature ?? 0.7,
    timeout: input.timeout,
    tools: input.tools,
    createdAt: now,
    updatedAt: now
  }

  agents[definition.id] = definition
  await writeAgentDefinitions(agents)

  console.log(`[AgentDefinitionStore] Created agent "${definition.name}" (${definition.id})`)
  return definition
}

/**
 * Gets a single agent definition by ID.
 * Returns the full definition (unmasked) for internal use.
 */
export async function getAgentDefinition(id: string): Promise<AgentDefinition | undefined> {
  const agents = await readAgentDefinitions()
  return agents[id]
}

/**
 * Lists all agent definitions with API keys masked.
 */
export async function listAgentDefinitions(): Promise<AgentDefinition[]> {
  const agents = await readAgentDefinitions()
  return Object.values(agents).map(maskDefinition)
}

/**
 * Updates an existing agent definition.
 * Preserves masked API keys (doesn't overwrite with the mask sentinel).
 */
export async function updateAgentDefinition(
  id: string,
  updates: UpdateAgentDefinitionRequest
): Promise<AgentDefinition | undefined> {
  const errors = validateAgentInput(updates, false)
  if (errors.length > 0) {
    throw new ValidationError(errors)
  }

  const agents = await readAgentDefinitions()
  const existing = agents[id]
  if (!existing) return undefined

  // Preserve API key if the client sent the masked value
  const resolvedApiKey = preserveApiKey(updates.apiKey, existing.apiKey)

  const updated: AgentDefinition = {
    ...existing,
    ...updates,
    // Always preserve these fields
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
    apiKey: resolvedApiKey
  }

  agents[id] = updated
  await writeAgentDefinitions(agents)

  console.log(`[AgentDefinitionStore] Updated agent "${updated.name}" (${id})`)
  return updated
}

/**
 * Deletes an agent definition by ID.
 */
export async function deleteAgentDefinition(id: string): Promise<boolean> {
  const agents = await readAgentDefinitions()
  if (!agents[id]) return false

  const name = agents[id].name
  delete agents[id]
  await writeAgentDefinitions(agents)

  console.log(`[AgentDefinitionStore] Deleted agent "${name}" (${id})`)
  return true
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Thrown when agent definition input fails validation.
 */
export class ValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Validation failed: ${errors.join(', ')}`)
    this.name = 'ValidationError'
  }
}
