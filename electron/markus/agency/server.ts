/**
 * Agency API Server
 *
 * Standalone Express + WebSocket server that exposes the Agency API.
 * Any client (Markus, curl, web GUI) can create conversations, send
 * messages, and receive streaming responses via REST + WebSocket.
 *
 * Not coupled to Electron — can run independently for development
 * or as a service.
 */

import express from 'express'
import http from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { query, type Query } from '@anthropic-ai/claude-agent-sdk'
import { AgencyConfig, getSdkEnvVars } from './config'
import { createAdapter } from './adapter'
import { getWritingSystemPrompt, getWritingAgents } from './modes/writing'
import { getProgrammingSystemPrompt, getProgrammingAgents } from './modes/programming'
import { createLoopDetector } from './hooks/loopDetector'
import { createSubtaskLimiter } from './hooks/subtaskLimiter'
import { getReviewSuggestion } from './hooks/reviewTrigger'
import { handleSdkMessage, type TransportSender } from './hooks/transport'
import { createAgencyToolServer } from './tools/index'

// ============================================================================
// Types
// ============================================================================

type AgencyMode = 'writing' | 'programming'

interface Conversation {
  id: string
  mode: AgencyMode
  workspace: string
  query: Query | null
  status: 'active' | 'complete' | 'error' | 'cancelled'
  wsClients: Set<WebSocket>
  createdAt: number
}

// ============================================================================
// Server
// ============================================================================

export function createAgencyServer(config: AgencyConfig) {
  const app = express()
  app.use(express.json({ limit: '50mb' }))

  const server = http.createServer(app)
  const wss = new WebSocketServer({ server })

  const conversations = new Map<string, Conversation>()

  // Start the format adapter (Anthropic ↔ OpenAI proxy)
  const adapter = createAdapter(config)

  // Allow SDK to spawn subprocess even when running inside Claude Code
  delete process.env.CLAUDECODE

  // Set SDK environment variables for model routing
  const envVars = getSdkEnvVars(config)
  Object.assign(process.env, envVars)

  // ============================================================================
  // REST Endpoints
  // ============================================================================

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', type: 'agency-api', conversations: conversations.size })
  })

  /** Create a new conversation */
  app.post('/conversations', (req, res) => {
    const { mode = 'writing', workspace } = req.body as { mode?: AgencyMode; workspace?: string }
    if (!workspace) {
      res.status(400).json({ error: 'workspace is required' })
      return
    }

    const id = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const conversation: Conversation = {
      id,
      mode,
      workspace,
      query: null,
      status: 'active',
      wsClients: new Set(),
      createdAt: Date.now()
    }
    conversations.set(id, conversation)

    res.json({ id, mode, workspace, status: 'active' })
  })

  /** Send a message to a conversation */
  app.post('/conversations/:id/message', async (req, res) => {
    const conv = conversations.get(req.params.id)
    if (!conv) {
      res.status(404).json({ error: 'Conversation not found' })
      return
    }

    const { content } = req.body as { content?: string }
    if (!content) {
      res.status(400).json({ error: 'content is required' })
      return
    }

    // Build transport sender that broadcasts to all connected WebSocket clients
    const send: TransportSender = (msg) => {
      const data = JSON.stringify(msg)
      for (const ws of conv.wsClients) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data)
        }
      }
    }

    // Get mode-specific configuration
    const systemPrompt = conv.mode === 'writing'
      ? getWritingSystemPrompt()
      : getProgrammingSystemPrompt()

    const agents = conv.mode === 'writing'
      ? getWritingAgents()
      : getProgrammingAgents()

    // Create hooks
    const loopDetector = createLoopDetector({
      windowSize: config.limits.loopDetectionWindow,
      repeatThreshold: 3
    })
    const subtaskLimiter = createSubtaskLimiter({
      maxSpawns: config.limits.maxSubagentSpawns
    })

    // Create MCP tool server
    const toolServer = createAgencyToolServer(conv.workspace, conv.id)

    try {
      // Start SDK query
      const q = query({
        prompt: content,
        options: {
          systemPrompt,
          agents,
          cwd: conv.workspace,
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

      conv.query = q

      // Process SDK messages and forward to clients
      let resultText = ''
      for await (const msg of q) {
        handleSdkMessage(msg as { type: string; [key: string]: unknown }, send)

        if ((msg as { type: string }).type === 'result') {
          const result = msg as { subtype: string; result?: string; error?: string }
          if (result.subtype === 'success') {
            resultText = result.result || ''
            conv.status = 'complete'
          } else {
            conv.status = 'error'
          }
        }
      }

      res.json({ status: conv.status, result: resultText })
    } catch (error) {
      conv.status = 'error'
      send({ type: 'error', message: String(error) })
      res.status(500).json({ error: String(error) })
    }
  })

  /** Get conversation status */
  app.get('/conversations/:id', (req, res) => {
    const conv = conversations.get(req.params.id)
    if (!conv) {
      res.status(404).json({ error: 'Conversation not found' })
      return
    }
    res.json({
      id: conv.id,
      mode: conv.mode,
      workspace: conv.workspace,
      status: conv.status,
      createdAt: conv.createdAt
    })
  })

  /** Cancel a conversation */
  app.delete('/conversations/:id', (req, res) => {
    const conv = conversations.get(req.params.id)
    if (!conv) {
      res.status(404).json({ error: 'Conversation not found' })
      return
    }
    if (conv.query) {
      conv.query.interrupt()
    }
    conv.status = 'cancelled'
    res.json({ id: conv.id, status: 'cancelled' })
  })

  /** List available models */
  app.get('/models', (_req, res) => {
    res.json({
      tiers: {
        opus: { modelId: config.models.opus.modelId, description: config.models.opus.description },
        sonnet: { modelId: config.models.sonnet.modelId, description: config.models.sonnet.description },
        haiku: { modelId: config.models.haiku.modelId, description: config.models.haiku.description }
      }
    })
  })

  /** Get/update settings */
  app.get('/settings', (_req, res) => {
    res.json(config)
  })

  // ============================================================================
  // WebSocket
  // ============================================================================

  wss.on('connection', (ws, req) => {
    // Extract conversation ID from URL path: /ws/:conversationId
    const url = new URL(req.url || '', `http://localhost:${config.apiPort}`)
    const pathParts = url.pathname.split('/')
    const convId = pathParts[pathParts.length - 1]

    const conv = conversations.get(convId || '')
    if (!conv) {
      ws.send(JSON.stringify({ type: 'error', message: 'Conversation not found' }))
      ws.close()
      return
    }

    conv.wsClients.add(ws)
    ws.on('close', () => conv.wsClients.delete(ws))
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'cancel' && conv.query) {
          conv.query.interrupt()
          conv.status = 'cancelled'
        }
      } catch {
        // Ignore malformed messages
      }
    })
  })

  // ============================================================================
  // Start
  // ============================================================================

  function start(): Promise<void> {
    return new Promise((resolve) => {
      server.listen(config.apiPort, () => {
        console.log(`[Agency API] Server running on http://localhost:${config.apiPort}`)
        console.log(`[Agency API] WebSocket on ws://localhost:${config.apiPort}/ws/:conversationId`)
        console.log(`[Agency API] Adapter on http://localhost:${config.adapterPort}`)
        resolve()
      })
    })
  }

  function stop(): Promise<void> {
    return new Promise((resolve) => {
      // Interrupt all active queries
      for (const conv of conversations.values()) {
        if (conv.query && conv.status === 'active') {
          conv.query.interrupt()
        }
      }
      wss.close()
      server.close(() => {
        adapter.server.close(() => resolve())
      })
    })
  }

  return { app, server, wss, start, stop }
}
