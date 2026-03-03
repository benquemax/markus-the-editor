/**
 * Agency API — Entry Point
 *
 * The Agency API is an isolated, multi-purpose agency module that uses
 * the Claude Agent SDK for orchestration, tool execution, and context
 * management. It works with local OpenAI-compatible LLMs via a built-in
 * format adapter that translates Anthropic Messages API ↔ OpenAI Chat
 * Completions.
 *
 * Usage:
 *   import { startAgencyApi, createDefaultConfig } from './agency'
 *   const config = createDefaultConfig()
 *   const server = await startAgencyApi(config)
 */

export { createDefaultConfig, createKimiCloudConfig, type AgencyConfig, type ModelConfig } from './config'
export { createAdapter } from './adapter'
export { createAgencyServer } from './server'
export { createAgencyToolServer } from './tools/index'
export { getWritingSystemPrompt, getWritingAgents } from './modes/writing'
export { getProgrammingSystemPrompt, getProgrammingAgents } from './modes/programming'

import { AgencyConfig } from './config'
import { createAgencyServer } from './server'

/**
 * Convenience function to start the full Agency API stack.
 * Creates the adapter, tool server, and API server.
 */
export async function startAgencyApi(config: AgencyConfig) {
  const server = createAgencyServer(config)
  await server.start()
  return server
}
