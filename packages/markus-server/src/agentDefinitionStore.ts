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
    // endpoint is optional — agents can inherit from providerId or main settings
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
    providerId: input.providerId,
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

  // Handle providerId: null means "clear provider reference"
  const resolvedProviderId = updates.providerId === null
    ? undefined
    : (updates.providerId ?? existing.providerId)

  const updated: AgentDefinition = {
    ...existing,
    ...updates,
    // Always preserve these fields
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
    apiKey: resolvedApiKey,
    providerId: resolvedProviderId
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
// Default Agents
// ============================================================================

/**
 * Default agent definitions seeded on first startup.
 * No providerId/endpoint/apiKey — they inherit main settings at runtime
 * via resolveAgentDefinition().
 */
const DEFAULT_AGENT_TEMPLATES: Array<Omit<CreateAgentDefinitionRequest, 'model' | 'endpoint' | 'apiKey' | 'providerId'>> = [
  {
    slug: 'research-analyst',
    name: 'Research Analyst',
    description: 'Methodical investigator for deep research, fact verification, and evidence gathering',
    roleDefinition: 'You are a meticulous Research Analyst. Your job is to conduct thorough investigations: reading files, searching codebases, querying the RAG index, and searching the web. You gather evidence methodically, cross-reference sources, and present clear, well-organized findings with full citations. You never guess when you can verify.',
    whenToUse: 'Use when the task requires finding information, understanding existing content, verifying facts, or gathering context from files and the web.',
    customInstructions: 'Always cite file paths and line numbers. Cross-reference multiple sources when possible. Present findings in structured format with confidence levels. Prefer searching over guessing.',
    tools: ['read_file', 'list_directory', 'search_files', 'search_web', 'duck_ai', 'vector_search'],
  },
  {
    slug: 'editor',
    name: 'Editor',
    description: 'Precision file editing specialist. Reads before editing, makes minimal targeted changes',
    roleDefinition: 'You are a precision Editor. Your job is to create, modify, and delete files with surgical accuracy. You always read a file before editing it, understand its structure and conventions, then make the smallest possible change that accomplishes the goal. You preserve existing style, formatting, and conventions.',
    whenToUse: 'Use when files need to be created, modified, or deleted.',
    customInstructions: 'Always read files before editing. Make the smallest change that accomplishes the goal. Preserve existing style and formatting. When making multiple edits to the same file, plan all changes before starting.',
    tools: ['read_file', 'list_directory', 'search_files', 'edit_file', 'create_file', 'delete_file', 'create_directory'],
  },
  {
    slug: 'critical-examiner',
    name: 'Critical Examiner',
    description: 'Sharp-minded quality reviewer. Challenges logic, consistency, and accuracy',
    roleDefinition: 'You are a sharp-minded Critical Examiner. Your job is to review content for correctness, logical consistency, factual accuracy, and potential issues. You challenge assumptions, spot weaknesses in arguments, identify inconsistencies, and verify claims against evidence. You provide specific, actionable feedback — never vague complaints.',
    whenToUse: 'Use when work needs to be reviewed, validated, or checked for quality. Also for analyzing arguments, checking logical consistency, and stress-testing ideas.',
    customInstructions: 'Be specific about issues — reference exact locations. Categorize issues by severity (critical, important, minor). Suggest fixes, not just problems. Acknowledge strengths alongside weaknesses.',
    tools: ['read_file', 'list_directory', 'search_files'],
  },
  {
    slug: 'creative-architect',
    name: 'Creative Architect',
    description: 'Visionary creative director for structure, ideation, and big-picture thinking',
    roleDefinition: 'You are a visionary Creative Architect. Your job is to see the big picture: generating ideas, proposing structures, brainstorming creative solutions, and designing overall architecture. You think in systems and narratives, offering multiple approaches with clear trade-offs. You balance creativity with practicality.',
    whenToUse: 'Use when the task needs creative thinking, brainstorming, structural planning, ideation, or high-level design decisions.',
    customInstructions: 'Provide multiple options (at least 2-3 alternatives). Explain trade-offs clearly. Think about both immediate needs and long-term implications. Use structural metaphors and frameworks to organize ideas.',
    tools: ['read_file', 'list_directory', 'search_files'],
  },
]

/**
 * Seeds default agent definitions if the store is empty.
 * Called on server startup to ensure users have agents out of the box.
 *
 * Default agents get the main LLM model but NO endpoint/apiKey — these are
 * resolved at runtime via resolveAgentDefinition() from the main settings.
 */
export async function ensureDefaultAgents(llmSettings: {
  model: string
  endpoint: string
  apiKey: string
}): Promise<void> {
  const existing = await readAgentDefinitions()
  if (Object.keys(existing).length > 0) {
    console.log(`[AgentDefinitionStore] ${Object.keys(existing).length} agents already exist, skipping seed`)
    return
  }

  console.log('[AgentDefinitionStore] No agents found, seeding defaults...')

  for (const template of DEFAULT_AGENT_TEMPLATES) {
    await createAgentDefinition({
      ...template,
      model: llmSettings.model,
      // No endpoint/apiKey — resolved at runtime from main settings
    })
  }

  console.log(`[AgentDefinitionStore] Seeded ${DEFAULT_AGENT_TEMPLATES.length} default agents`)
}

// ============================================================================
// Agent Resolution
// ============================================================================

/**
 * Resolves an agent definition's LLM configuration at runtime.
 *
 * Resolution order:
 * 1. If providerId set → resolve endpoint/apiKey from that provider
 * 2. If raw endpoint set (no providerId) → use as-is (backward compat)
 * 3. Neither → fall back to main LLM settings
 *
 * Returns a copy with concrete endpoint/apiKey values filled in.
 */
export function resolveAgentDefinition(
  agent: AgentDefinition,
  providers: Array<{ id: string; endpoint: string; apiKey?: string }>,
  mainLlmSettings: { endpoint: string; apiKey: string; model: string }
): AgentDefinition {
  // Case 1: Provider reference
  if (agent.providerId) {
    const provider = providers.find(p => p.id === agent.providerId)
    if (provider) {
      return {
        ...agent,
        endpoint: provider.endpoint,
        apiKey: agent.apiKey || provider.apiKey,
      }
    }
    // Provider not found — fall through to main settings
    console.warn(`[AgentDefinitionStore] Provider ${agent.providerId} not found for agent ${agent.slug}, using main settings`)
  }

  // Case 2: Direct endpoint (backward compat)
  if (agent.endpoint) {
    return agent
  }

  // Case 3: No provider, no endpoint — use main settings
  return {
    ...agent,
    endpoint: mainLlmSettings.endpoint,
    apiKey: agent.apiKey || mainLlmSettings.apiKey,
    model: agent.model || mainLlmSettings.model,
  }
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
