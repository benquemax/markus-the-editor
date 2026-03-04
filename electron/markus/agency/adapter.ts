/**
 * Anthropic ↔ OpenAI Format Adapter
 *
 * A lightweight HTTP proxy that accepts Anthropic Messages API requests
 * from the Claude Agent SDK and translates them to OpenAI Chat Completions
 * format for local LLM servers (Ollama, vLLM, llama.cpp).
 *
 * Handles:
 * - Message format conversion (system messages, tool use, tool results)
 * - Tool definition format translation
 * - Streaming SSE event translation
 * - Model-based routing to the correct server (GPU vs CPU)
 */

import express from 'express'
import http from 'http'
import { AgencyConfig, resolveModelConfig } from './config'

// ============================================================================
// Anthropic → OpenAI Message Translation
// ============================================================================

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

interface AnthropicContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'image'
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: string | AnthropicContentBlock[]
  is_error?: boolean
}

interface AnthropicToolDef {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

interface AnthropicRequest {
  model: string
  messages: AnthropicMessage[]
  system?: string | Array<{ type: 'text'; text: string }>
  tools?: AnthropicToolDef[]
  max_tokens: number
  temperature?: number
  stream?: boolean
  stop_sequences?: string[]
  metadata?: Record<string, unknown>
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: OpenAIToolCall[]
  tool_call_id?: string
  name?: string
}

interface OpenAIToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

/**
 * Converts Anthropic Messages API request body to OpenAI Chat Completions format.
 */
function translateRequest(anthropicReq: AnthropicRequest): Record<string, unknown> {
  const openaiMessages: OpenAIMessage[] = []

  // System message
  if (anthropicReq.system) {
    const systemText = typeof anthropicReq.system === 'string'
      ? anthropicReq.system
      : anthropicReq.system.map(b => b.text).join('\n\n')
    openaiMessages.push({ role: 'system', content: systemText })
  }

  // Convert each Anthropic message
  for (const msg of anthropicReq.messages) {
    if (typeof msg.content === 'string') {
      openaiMessages.push({ role: msg.role, content: msg.content })
      continue
    }

    // Content is an array of blocks
    if (msg.role === 'assistant') {
      // Assistant messages may contain text + tool_use blocks
      const textParts: string[] = []
      const toolCalls: OpenAIToolCall[] = []

      for (const block of msg.content) {
        if (block.type === 'text' && block.text) {
          textParts.push(block.text)
        } else if (block.type === 'tool_use' && block.id && block.name) {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input || {})
            }
          })
        }
      }

      const assistantMsg: OpenAIMessage = {
        role: 'assistant',
        content: textParts.length > 0 ? textParts.join('') : null
      }
      if (toolCalls.length > 0) {
        assistantMsg.tool_calls = toolCalls
        // Kimi K2.5 requires non-empty reasoning_content in assistant messages
        // with tool calls when thinking mode is enabled. This stub satisfies the
        // API requirement without affecting model behavior.
        const extMsg = assistantMsg as Record<string, unknown>
        extMsg.reasoning_content = 'Analyzing and determining the next action.'
      }
      openaiMessages.push(assistantMsg)
    } else if (msg.role === 'user') {
      // User messages may contain text + tool_result blocks
      // Tool results need to become separate 'tool' role messages in OpenAI format
      const textParts: string[] = []
      const toolResults: Array<{ tool_use_id: string; content: string; is_error?: boolean }> = []

      for (const block of msg.content) {
        if (block.type === 'text' && block.text) {
          textParts.push(block.text)
        } else if (block.type === 'tool_result' && block.tool_use_id) {
          let resultContent: string
          if (typeof block.content === 'string') {
            resultContent = block.content
          } else if (Array.isArray(block.content)) {
            resultContent = block.content
              .filter((b: AnthropicContentBlock) => b.type === 'text' && b.text)
              .map((b: AnthropicContentBlock) => b.text)
              .join('')
          } else {
            resultContent = ''
          }
          if (block.is_error) {
            resultContent = `Error: ${resultContent}`
          }
          toolResults.push({
            tool_use_id: block.tool_use_id,
            content: resultContent
          })
        }
      }

      // Add tool result messages first (they must follow the assistant's tool_calls)
      for (const result of toolResults) {
        openaiMessages.push({
          role: 'tool',
          content: result.content,
          tool_call_id: result.tool_use_id
        })
      }

      // Add user text if present
      if (textParts.length > 0) {
        openaiMessages.push({ role: 'user', content: textParts.join('') })
      }
    }
  }

  // Build OpenAI request body
  const openaiReq: Record<string, unknown> = {
    model: anthropicReq.model,
    messages: openaiMessages,
    max_tokens: anthropicReq.max_tokens,
    stream: anthropicReq.stream || false
  }

  if (anthropicReq.temperature !== undefined) {
    openaiReq.temperature = anthropicReq.temperature
  }

  if (anthropicReq.stop_sequences) {
    openaiReq.stop = anthropicReq.stop_sequences
  }

  // Translate tool definitions
  if (anthropicReq.tools && anthropicReq.tools.length > 0) {
    openaiReq.tools = anthropicReq.tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema
      }
    }))
  }

  return openaiReq
}

// ============================================================================
// OpenAI → Anthropic Response Translation
// ============================================================================

interface OpenAIResponse {
  id: string
  choices: Array<{
    index: number
    message: {
      role: string
      content: string | null
      tool_calls?: OpenAIToolCall[]
    }
    finish_reason: string
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

/**
 * Converts an OpenAI Chat Completions response to Anthropic Messages format.
 */
function translateResponse(openaiResp: OpenAIResponse, model: string): Record<string, unknown> {
  const choice = openaiResp.choices?.[0]
  if (!choice) {
    return {
      id: `msg_${openaiResp.id || Date.now()}`,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      model,
      stop_reason: 'end_turn',
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
    }
  }

  const content: Array<Record<string, unknown>> = []

  // Add text content if present
  if (choice.message.content) {
    content.push({ type: 'text', text: choice.message.content })
  }

  // Add tool use blocks if present
  if (choice.message.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      let parsedInput: Record<string, unknown> = {}
      try {
        parsedInput = JSON.parse(tc.function.arguments || '{}')
      } catch {
        parsedInput = { raw: tc.function.arguments }
      }
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input: parsedInput
      })
    }
  }

  // Ensure content is not empty
  if (content.length === 0) {
    content.push({ type: 'text', text: '' })
  }

  // Map finish_reason to stop_reason
  let stopReason = 'end_turn'
  if (choice.finish_reason === 'tool_calls' || choice.message.tool_calls?.length) {
    stopReason = 'tool_use'
  } else if (choice.finish_reason === 'length') {
    stopReason = 'max_tokens'
  } else if (choice.finish_reason === 'stop') {
    stopReason = 'end_turn'
  }

  return {
    id: `msg_${openaiResp.id || Date.now()}`,
    type: 'message',
    role: 'assistant',
    content,
    model,
    stop_reason: stopReason,
    usage: {
      input_tokens: openaiResp.usage?.prompt_tokens || 0,
      output_tokens: openaiResp.usage?.completion_tokens || 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0
    }
  }
}

// ============================================================================
// Streaming Translation (OpenAI SSE → Anthropic SSE)
// ============================================================================

/**
 * Translates a stream of OpenAI SSE chunks into Anthropic SSE events.
 * The Claude Agent SDK expects Anthropic's streaming format:
 * - message_start
 * - content_block_start
 * - content_block_delta (text_delta)
 * - content_block_stop
 * - message_delta (with stop_reason)
 * - message_stop
 */
async function translateStream(
  openaiStream: ReadableStream<Uint8Array>,
  model: string,
  res: express.Response
): Promise<void> {
  const reader = openaiStream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let blockIndex = 0
  let hasStarted = false
  const toolCallAccumulators: Map<number, { id: string; name: string; args: string }> = new Map()

  // Send message_start event
  const msgId = `msg_${Date.now()}`
  sendSSE(res, {
    type: 'message_start',
    message: {
      id: msgId,
      type: 'message',
      role: 'assistant',
      content: [],
      model,
      stop_reason: null,
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
    }
  })

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed === 'data: [DONE]' || trimmed === 'data:[DONE]') {
          if (trimmed === 'data: [DONE]' || trimmed === 'data:[DONE]') {
            // Flush any accumulated tool calls
            for (const [idx, tc] of toolCallAccumulators) {
              let parsedInput: Record<string, unknown> = {}
              try { parsedInput = JSON.parse(tc.args || '{}') } catch { parsedInput = { raw: tc.args } }

              sendSSE(res, {
                type: 'content_block_start',
                index: idx,
                content_block: { type: 'tool_use', id: tc.id, name: tc.name, input: {} }
              })
              sendSSE(res, {
                type: 'content_block_delta',
                index: idx,
                delta: { type: 'input_json_delta', partial_json: JSON.stringify(parsedInput) }
              })
              sendSSE(res, { type: 'content_block_stop', index: idx })
            }
          }
          continue
        }

        if (!trimmed.startsWith('data:')) continue

        try {
          const jsonStr = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed.slice(5)
          const chunk = JSON.parse(jsonStr)
          const delta = chunk.choices?.[0]?.delta
          const finishReason = chunk.choices?.[0]?.finish_reason

          if (!delta && !finishReason) continue

          // Handle text content (skip reasoning_content from thinking models
          // like Kimi K2.5 — only forward the final content output)
          if (delta?.content) {
            if (!hasStarted) {
              // Start text content block
              sendSSE(res, {
                type: 'content_block_start',
                index: blockIndex,
                content_block: { type: 'text', text: '' }
              })
              hasStarted = true
            }
            sendSSE(res, {
              type: 'content_block_delta',
              index: blockIndex,
              delta: { type: 'text_delta', text: delta.content }
            })
          }

          // Handle tool calls (streamed incrementally)
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const tcIndex = tc.index ?? 0

              if (!toolCallAccumulators.has(tcIndex)) {
                // Close text block if open
                if (hasStarted) {
                  sendSSE(res, { type: 'content_block_stop', index: blockIndex })
                  blockIndex++
                  hasStarted = false
                }
                toolCallAccumulators.set(tcIndex, {
                  id: tc.id || `toolu_${Date.now()}_${tcIndex}`,
                  name: tc.function?.name || '',
                  args: ''
                })
              }

              const acc = toolCallAccumulators.get(tcIndex)!
              if (tc.id) acc.id = tc.id
              if (tc.function?.name) acc.name = tc.function.name
              if (tc.function?.arguments) acc.args += tc.function.arguments
            }
          }

          // Handle finish
          if (finishReason) {
            // Close text block if still open
            if (hasStarted) {
              sendSSE(res, { type: 'content_block_stop', index: blockIndex })
              blockIndex++
              hasStarted = false
            }

            // Flush tool calls
            for (const [, tc] of toolCallAccumulators) {
              let parsedInput: Record<string, unknown> = {}
              try { parsedInput = JSON.parse(tc.args || '{}') } catch { parsedInput = { raw: tc.args } }

              sendSSE(res, {
                type: 'content_block_start',
                index: blockIndex,
                content_block: { type: 'tool_use', id: tc.id, name: tc.name, input: {} }
              })
              sendSSE(res, {
                type: 'content_block_delta',
                index: blockIndex,
                delta: { type: 'input_json_delta', partial_json: JSON.stringify(parsedInput) }
              })
              sendSSE(res, { type: 'content_block_stop', index: blockIndex })
              blockIndex++
            }
            toolCallAccumulators.clear()

            // Map finish reason
            let stopReason = 'end_turn'
            if (finishReason === 'tool_calls') stopReason = 'tool_use'
            else if (finishReason === 'length') stopReason = 'max_tokens'

            sendSSE(res, {
              type: 'message_delta',
              delta: { stop_reason: stopReason },
              usage: { output_tokens: chunk.usage?.completion_tokens || 0 }
            })
            sendSSE(res, { type: 'message_stop' })
          }
        } catch (e) {
          // Skip unparseable chunks
          console.log('[Adapter] SSE parse error:', (e as Error).message)
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  // If stream ended without a finish_reason, close properly
  if (hasStarted) {
    sendSSE(res, { type: 'content_block_stop', index: blockIndex })
  }
  // Always send final events if not sent
  sendSSE(res, {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn' },
    usage: { output_tokens: 0 }
  })
  sendSSE(res, { type: 'message_stop' })
}

function sendSSE(res: express.Response, data: Record<string, unknown>): void {
  res.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`)
}

// ============================================================================
// Adapter Server
// ============================================================================

/**
 * Creates and starts the format adapter HTTP server.
 * Listens for Anthropic Messages API requests and forwards them
 * as OpenAI Chat Completions to the appropriate model server.
 */
export function createAdapter(config: AgencyConfig): { app: express.Express; server: http.Server } {
  const app = express()
  app.use(express.json({ limit: '50mb' }))

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', type: 'anthropic-openai-adapter' })
  })

  // Main endpoint: Anthropic Messages API
  app.post('/v1/messages', async (req, res) => {
    const anthropicReq = req.body as AnthropicRequest
    const model = anthropicReq.model
    const modelConfig = resolveModelConfig(config, model)
    const serverUrl = modelConfig.serverUrl

    // Build the chat completions endpoint URL
    const openaiEndpoint = serverUrl.endsWith('/v1')
      ? `${serverUrl}/chat/completions`
      : `${serverUrl}/v1/chat/completions`

    // Show descriptive role name so logs read "worker (ministral-3:14b)" instead of raw SDK alias
    const modelLower = model.toLowerCase()
    const roleLabel = modelLower.includes('haiku') ? `worker (${modelConfig.modelId})`
      : modelLower.includes('sonnet') ? `analyst (${modelConfig.modelId})`
      : modelLower.includes('opus') ? `orchestrator (${modelConfig.modelId})`
      : modelConfig.modelId
    console.log(`[Adapter] ${roleLabel} → ${openaiEndpoint} (stream=${anthropicReq.stream})`)

    try {
      const openaiReq = translateRequest(anthropicReq)

      // Build headers with auth and any provider-specific custom headers
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (modelConfig.apiKey) {
        headers['Authorization'] = `Bearer ${modelConfig.apiKey}`
      } else {
        headers['Authorization'] = 'Bearer not-needed'
      }
      if (modelConfig.customHeaders) {
        Object.assign(headers, modelConfig.customHeaders)
      }

      const upstreamRes = await fetch(openaiEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(openaiReq)
      })

      if (!upstreamRes.ok) {
        const errorText = await upstreamRes.text()
        console.error(`[Adapter] Upstream error ${upstreamRes.status}:`, errorText.slice(0, 500))
        res.status(upstreamRes.status).json({
          type: 'error',
          error: { type: 'api_error', message: errorText }
        })
        return
      }

      if (anthropicReq.stream) {
        // Streaming response
        res.setHeader('Content-Type', 'text/event-stream')
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('Connection', 'keep-alive')

        if (!upstreamRes.body) {
          res.status(500).json({ type: 'error', error: { type: 'api_error', message: 'No response body' } })
          return
        }

        await translateStream(upstreamRes.body as unknown as ReadableStream<Uint8Array>, model, res)
        res.end()
      } else {
        // Non-streaming response
        const openaiResp = await upstreamRes.json() as OpenAIResponse
        const anthropicResp = translateResponse(openaiResp, model)
        res.json(anthropicResp)
      }
    } catch (error) {
      console.error('[Adapter] Error:', error)
      res.status(500).json({
        type: 'error',
        error: { type: 'api_error', message: String(error) }
      })
    }
  })

  // Token counting endpoint (stub — SDK may call this)
  app.post('/v1/messages/count_tokens', (req, res) => {
    // Return a rough estimate based on character count / 4
    const body = req.body as AnthropicRequest
    const totalChars = JSON.stringify(body.messages).length + (typeof body.system === 'string' ? body.system.length : 0)
    res.json({ input_tokens: Math.ceil(totalChars / 4) })
  })

  const server = app.listen(config.adapterPort, () => {
    console.log(`[Adapter] Anthropic↔OpenAI adapter running on http://localhost:${config.adapterPort}`)
  })

  return { app, server }
}
