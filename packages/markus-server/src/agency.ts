/**
 * Agency API Integration
 *
 * Integrates the Claude Agent SDK-based agency backend into the Markus
 * server. Manages the format adapter lifecycle and provides a
 * `runAgencyQuery()` function that replaces `runThoughtLoop()` when
 * the agency backend is enabled in settings.
 *
 * The adapter translates Anthropic Messages API ↔ OpenAI Chat Completions
 * so the SDK can work with local models or Kimi cloud.
 *
 * Note: Static imports work when the server is bundled via esbuild
 * (build-server.mjs). For standalone tsx dev mode, the server must be
 * bundled first (npm run build:core in packages/markus-server/).
 */

import { query } from '@anthropic-ai/claude-agent-sdk'
import { createKimiCloudConfig, createDefaultConfig, getSdkEnvVars, type AgencyConfig } from '../../../electron/markus/agency/config'
import { createAdapter } from '../../../electron/markus/agency/adapter'
import { getWritingSystemPrompt, getWritingAgents } from '../../../electron/markus/agency/modes/writing'
import { getProgrammingSystemPrompt, getProgrammingAgents } from '../../../electron/markus/agency/modes/programming'
import { createLoopDetector } from '../../../electron/markus/agency/hooks/loopDetector'
import { createSubtaskLimiter } from '../../../electron/markus/agency/hooks/subtaskLimiter'
import { getReviewSuggestion } from '../../../electron/markus/agency/hooks/reviewTrigger'
import { createAgencyToolServer } from '../../../electron/markus/agency/tools/index'
import type { WebSocketTransport } from './websocket/transport'

type AgencyMode = 'writing' | 'programming'

// Singleton adapter state — starts once, stays running for server's lifetime
let adapterStarted = false
let cachedConfig: AgencyConfig | null = null

/**
 * Lazily initializes the agency backend on first use.
 * Starts the format adapter and sets SDK environment variables.
 * Uses 'local' backend (ferocitee servers) by default, or 'kimi-cloud'
 * when configured in settings.yaml.
 */
function ensureAgency(apiKey: string, backend: string = 'local'): AgencyConfig {
  if (adapterStarted && cachedConfig) return cachedConfig

  const config = backend === 'kimi-cloud'
    ? createKimiCloudConfig(apiKey)
    : createDefaultConfig()

  // Start the format adapter (Anthropic ↔ OpenAI proxy)
  createAdapter(config)
  console.log(`[Agency] Format adapter started on port ${config.adapterPort}`)
  console.log(`[Agency] Models:`)
  console.log(`[Agency]   orchestrator → ${config.models.orchestrator.modelId} @ ${config.models.orchestrator.serverUrl}`)
  console.log(`[Agency]   analyst      → ${config.models.analyst.modelId} @ ${config.models.analyst.serverUrl}`)
  console.log(`[Agency]   worker       → ${config.models.worker.modelId} @ ${config.models.worker.serverUrl}`)

  // Allow SDK to spawn subprocess even when running inside Claude Code
  delete process.env.CLAUDECODE

  // Set SDK environment variables for model routing
  const envVars = getSdkEnvVars(config)
  Object.assign(process.env, envVars)
  console.log('[Agency] SDK env vars set:', Object.keys(envVars).join(', '))

  adapterStarted = true
  cachedConfig = config
  return config
}

/**
 * Runs a query through the Claude Agent SDK instead of the legacy thought loop.
 * Streams SDK events as WebSocket messages to the connected client.
 */
export async function runAgencyQuery(
  content: string,
  workspace: string,
  mode: AgencyMode,
  apiKey: string,
  transport: WebSocketTransport,
  abortSignal?: AbortSignal,
  backend: string = 'local'
): Promise<{ waitingForInput: boolean }> {
  const config = ensureAgency(apiKey, backend)

  // Mode-specific configuration
  const systemPrompt = mode === 'writing'
    ? getWritingSystemPrompt()
    : getProgrammingSystemPrompt()

  const agents = mode === 'writing'
    ? getWritingAgents()
    : getProgrammingAgents()

  // Per-query hooks (fresh state each time)
  const loopDetector = createLoopDetector({
    windowSize: config.limits.loopDetectionWindow,
    repeatThreshold: 3
  })
  const subtaskLimiter = createSubtaskLimiter({
    maxSpawns: config.limits.maxSubagentSpawns
  })

  // MCP tool server for markus_edit and markus_tasks
  const conversationId = `ws_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const toolServer = createAgencyToolServer(workspace, conversationId)

  console.log(`[Agency] Starting ${mode} query in ${workspace}`)
  transport.sendIterationStarted(0)

  // Start SDK query
  const q = query({
    prompt: content,
    options: {
      systemPrompt,
      agents,
      cwd: workspace,
      maxTurns: config.limits.maxTurnsOrchestrator,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      mcpServers: { 'agency-tools': toolServer },
      hooks: {
        PostToolUse: [{
          callback: async (input) => {
            const toolName = (input as { tool_name?: string }).tool_name || ''
            const toolInput = (input as { tool_input?: unknown }).tool_input
            const warning = loopDetector.checkForLoop(toolName, toolInput)
            if (warning) {
              return { continue: true, systemMessage: warning }
            }
            return { continue: true }
          }
        }],
        PreToolUse: [{
          matcher: { toolName: 'Task' },
          callback: async () => {
            const denial = subtaskLimiter.checkLimit()
            if (denial) {
              return {
                continue: false,
                hookSpecificOutput: { permissionDecision: 'deny' as const },
                stopReason: denial
              }
            }
            return { continue: true }
          }
        }],
        SubagentStop: [{
          callback: async (input) => {
            const agentName = (input as { agent_name?: string }).agent_name || ''
            const suggestion = getReviewSuggestion(agentName)
            if (suggestion) {
              return { continue: true, systemMessage: suggestion }
            }
            return { continue: true }
          }
        }]
      }
    }
  })

  // Process SDK messages and forward to WebSocket client
  let turnCount = 0
  let messageCount = 0
  let textCharsSent = 0

  try {
    for await (const msg of q) {
      messageCount++

      // Check for cancellation
      if (abortSignal?.aborted) {
        q.interrupt()
        break
      }

      const msgType = (msg as { type: string }).type
      const msgSubtype = (msg as { subtype?: string }).subtype

      // Log every message type — sparse for high-frequency types, always for key events
      if (messageCount <= 5 || messageCount % 20 === 0 || ['result', 'system'].includes(msgType)) {
        console.log(`[Agency] msg #${messageCount}: ${msgType}${msgSubtype ? `/${msgSubtype}` : ''}`)
      }

      switch (msgType) {
        case 'assistant': {
          // Full assistant message with content blocks (BetaMessage).
          // Don't send iteration_started here — the SDK's concept of "turns"
          // doesn't map to the UI's "iterations". Sending iteration_started
          // clears streamingContent in the UI, which drops accumulated text.
          // All text chunks accumulate into one streamingContent block;
          // the handler's sendComplete() finalizes it as the assistant message.
          const rawMsg = msg as { message?: { model?: string; content?: Array<{ type: string; text?: string; name?: string; id?: string; input?: unknown }> }; agent_name?: string }
          const message = rawMsg.message
          if (!message?.content) break

          // Log which model and agent produced this message
          const agentLabel = rawMsg.agent_name ? ` [agent: ${rawMsg.agent_name}]` : ' [orchestrator]'
          const modelLabel = message.model ? ` (${message.model})` : ''
          const toolNames = message.content.filter(b => b.type === 'tool_use').map(b => b.name).join(', ')
          const summary = toolNames ? `tools: ${toolNames}` : `text: ${message.content.filter(b => b.type === 'text').map(b => b.text?.slice(0, 40)).join(' ').trim()}`
          console.log(`[Agency] assistant turn #${turnCount + 1}${agentLabel}${modelLabel} — ${summary}`)

          // Add paragraph separator between multi-turn assistant responses
          // so they don't run together as one wall of text
          if (textCharsSent > 0) {
            const hasText = message.content.some(b => b.type === 'text' && b.text?.trim())
            if (hasText) {
              transport.sendChunk('\n\n')
            }
          }

          for (const block of message.content) {
            if (block.type === 'text' && block.text) {
              transport.sendChunk(block.text)
              textCharsSent += block.text.length
            } else if (block.type === 'tool_use') {
              transport.sendToolStarted({
                id: block.id || `tool_${Date.now()}`,
                name: block.name || 'unknown',
                arguments: (block.input as Record<string, unknown>) || {}
              })
            }
          }
          turnCount++
          break
        }

        case 'stream_event': {
          // Streaming event from the Anthropic API (BetaRawMessageStreamEvent)
          const event = (msg as { event?: { type?: string; delta?: { type?: string; text?: string }; content_block?: { type?: string; name?: string; id?: string } } }).event
          if (!event) break

          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
            transport.sendChunk(event.delta.text)
          } else if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
            transport.sendToolStarted({
              id: event.content_block.id || `tool_${Date.now()}`,
              name: event.content_block.name || 'unknown',
              arguments: {}
            })
          }
          break
        }

        case 'tool_progress': {
          // Tool is executing — shows activity in the UI
          break
        }

        case 'result': {
          // Final SDK result — may contain the agent's complete text response.
          // If assistant messages already sent text chunks (textCharsSent > 0),
          // skip result.result to avoid duplicating the response in the UI.
          // Otherwise, result.result is the only source of response text.
          const result = msg as { subtype: string; result?: string; error?: string; duration_ms?: number; num_turns?: number }
          console.log(`[Agency] Result: subtype=${result.subtype}, textAlreadySent=${textCharsSent}`)

          if (result.subtype === 'error') {
            transport.sendError(result.error || 'Unknown SDK error')
          } else if (result.subtype === 'success' && result.result && textCharsSent === 0) {
            // Only send result text if no text was streamed via assistant messages
            transport.sendChunk(result.result)
            textCharsSent += result.result.length
          }
          break
        }

        case 'system': {
          // System notifications (init, agent lifecycle, status, etc.)
          if (msgSubtype === 'init') {
            console.log('[Agency] SDK initialized')
          } else {
            // Log all system messages to catch agent start/stop events
            const sysMsg = msg as Record<string, unknown>
            const agentName = (sysMsg.agent_name || sysMsg.agentName) as string | undefined
            const extra = agentName ? ` [agent: ${agentName}]` : ''
            console.log(`[Agency] system/${msgSubtype}${extra}`)
          }
          break
        }

        default: {
          // Log unhandled types to help diagnose missing handlers
          console.log(`[Agency] Unhandled message type: ${msgType}${msgSubtype ? `/${msgSubtype}` : ''}`)
          break
        }
      }
    }
  } catch (error) {
    console.error('[Agency] Query error:', error)
    transport.sendError(error instanceof Error ? error.message : String(error))
  }

  console.log(`[Agency] Query complete after ${turnCount} SDK turns`)

  // Agency queries don't use blocking tools, so never waiting for input
  return { waitingForInput: false }
}
