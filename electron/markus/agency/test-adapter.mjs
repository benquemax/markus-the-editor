/**
 * Quick test script for the Anthropic ↔ OpenAI adapter.
 * Run with: node electron/markus/agency/test-adapter.mjs
 *
 * Tests with Kimi cloud inference first (fast, reliable),
 * then optionally with local models.
 */

import express from 'express'

// ============================================================================
// Config — test with Kimi cloud first, then local models
// ============================================================================

const KIMI_CONFIG = {
  modelId: 'kimi-for-coding',
  serverUrl: 'https://api.kimi.com/coding/v1',
  apiKey: 'sk-kimi-iarkBO1adOhwjjYxvtB5xmtH6Gtc8zfuZByhTFe24IQ9O7RJWZqJKK6P8Pugml5V',
  customHeaders: {
    'X-Traffic-Source': 'self',
    'User-Agent': 'KimiCLI/1.3'
  }
}

const LOCAL_CONFIGS = {
  haiku: { modelId: 'ministral-3:14b', serverUrl: 'http://ferocitee:11435', apiKey: null, customHeaders: null },
  sonnet: { modelId: 'qwen3-coder-next:latest', serverUrl: 'http://ferocitee:11434', apiKey: null, customHeaders: null },
}

const ADAPTER_PORT = 3860

// ============================================================================
// Adapter logic (inline JS for testing without TS compilation)
// ============================================================================

function resolveBackend(model) {
  if (model === KIMI_CONFIG.modelId) return KIMI_CONFIG
  for (const [, cfg] of Object.entries(LOCAL_CONFIGS)) {
    if (cfg.modelId === model) return cfg
  }
  return LOCAL_CONFIGS.haiku
}

function translateRequest(req) {
  const messages = []

  if (req.system) {
    const text = typeof req.system === 'string' ? req.system : req.system.map(b => b.text).join('\n\n')
    messages.push({ role: 'system', content: text })
  }

  for (const msg of req.messages) {
    if (typeof msg.content === 'string') {
      messages.push({ role: msg.role, content: msg.content })
      continue
    }

    if (msg.role === 'assistant') {
      const textParts = []
      const toolCalls = []
      for (const block of msg.content) {
        if (block.type === 'text') textParts.push(block.text)
        else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id, type: 'function',
            function: { name: block.name, arguments: JSON.stringify(block.input || {}) }
          })
        }
      }
      const m = { role: 'assistant', content: textParts.join('') || null }
      if (toolCalls.length) {
        m.tool_calls = toolCalls
        // Kimi requires non-empty reasoning_content in assistant messages with
        // tool calls when thinking mode is enabled.
        m.reasoning_content = 'Analyzing and determining the next action.'
      }
      messages.push(m)
    } else if (msg.role === 'user') {
      const textParts = []
      const toolResults = []
      for (const block of msg.content) {
        if (block.type === 'text') textParts.push(block.text)
        else if (block.type === 'tool_result') {
          const content = typeof block.content === 'string' ? block.content
            : Array.isArray(block.content) ? block.content.filter(b => b.type === 'text').map(b => b.text).join('') : ''
          toolResults.push({ tool_call_id: block.tool_use_id, content })
        }
      }
      for (const r of toolResults) messages.push({ role: 'tool', ...r })
      if (textParts.length) messages.push({ role: 'user', content: textParts.join('') })
    }
  }

  const body = { model: req.model, messages, max_tokens: req.max_tokens, stream: req.stream || false }
  if (req.temperature !== undefined) body.temperature = req.temperature
  if (req.tools?.length) {
    body.tools = req.tools.map(t => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.input_schema }
    }))
  }
  return body
}

function translateResponse(resp, model) {
  const choice = resp.choices?.[0]
  if (!choice) return { id: `msg_${Date.now()}`, type: 'message', role: 'assistant', content: [{ type: 'text', text: '' }], model, stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 } }

  const content = []
  if (choice.message.content) content.push({ type: 'text', text: choice.message.content })
  if (choice.message.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      let input = {}
      try { input = JSON.parse(tc.function.arguments) } catch { input = { raw: tc.function.arguments } }
      content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input })
    }
  }
  if (!content.length) content.push({ type: 'text', text: '' })

  let stop_reason = 'end_turn'
  if (choice.finish_reason === 'tool_calls' || choice.message.tool_calls?.length) stop_reason = 'tool_use'
  else if (choice.finish_reason === 'length') stop_reason = 'max_tokens'

  return {
    id: `msg_${resp.id || Date.now()}`, type: 'message', role: 'assistant', content, model, stop_reason,
    usage: { input_tokens: resp.usage?.prompt_tokens || 0, output_tokens: resp.usage?.completion_tokens || 0 }
  }
}

// ============================================================================
// Start adapter server
// ============================================================================

const app = express()
app.use(express.json({ limit: '50mb' }))

app.post('/v1/messages', async (req, res) => {
  const anthropicReq = req.body
  const model = anthropicReq.model
  const backend = resolveBackend(model)

  // Build endpoint URL
  const endpoint = backend.serverUrl.endsWith('/v1')
    ? `${backend.serverUrl}/chat/completions`
    : `${backend.serverUrl}/v1/chat/completions`

  console.log(`[Adapter] ${model} → ${endpoint} (stream=${anthropicReq.stream})`)

  // Build headers with auth and provider-specific custom headers
  const headers = { 'Content-Type': 'application/json' }
  if (backend.apiKey) {
    headers['Authorization'] = `Bearer ${backend.apiKey}`
  }
  if (backend.customHeaders) {
    Object.assign(headers, backend.customHeaders)
  }

  try {
    const openaiReq = translateRequest(anthropicReq)

    if (anthropicReq.stream) {
      const upstreamRes = await fetch(endpoint, {
        method: 'POST', headers,
        body: JSON.stringify(openaiReq)
      })

      if (!upstreamRes.ok) {
        const err = await upstreamRes.text()
        console.error(`[Adapter] Upstream error ${upstreamRes.status}:`, err.slice(0, 300))
        res.status(upstreamRes.status).json({ type: 'error', error: { message: err } })
        return
      }

      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')

      const msgId = `msg_${Date.now()}`
      const sse = (data) => res.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`)

      sse({ type: 'message_start', message: { id: msgId, type: 'message', role: 'assistant', content: [], model, stop_reason: null, usage: { input_tokens: 0, output_tokens: 0 } } })

      const reader = upstreamRes.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let blockStarted = false
      let blockIndex = 0
      let sentStop = false
      let toolCallAccumulators = new Map()

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed || trimmed === 'data: [DONE]' || trimmed === 'data:[DONE]') continue
            if (!trimmed.startsWith('data:')) continue

            try {
              const jsonStr = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed.slice(5)
              const chunk = JSON.parse(jsonStr)
              const delta = chunk.choices?.[0]?.delta
              const finishReason = chunk.choices?.[0]?.finish_reason

              // Skip reasoning_content tokens (Kimi K2.5 thinking output).
              // Only forward actual content tokens to the SDK.
              if (delta?.content) {
                if (!blockStarted) {
                  sse({ type: 'content_block_start', index: blockIndex, content_block: { type: 'text', text: '' } })
                  blockStarted = true
                }
                sse({ type: 'content_block_delta', index: blockIndex, delta: { type: 'text_delta', text: delta.content } })
              }

              // Handle streamed tool calls
              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const tcIndex = tc.index ?? 0
                  if (!toolCallAccumulators.has(tcIndex)) {
                    if (blockStarted) {
                      sse({ type: 'content_block_stop', index: blockIndex })
                      blockIndex++
                      blockStarted = false
                    }
                    toolCallAccumulators.set(tcIndex, { id: tc.id || `toolu_${Date.now()}_${tcIndex}`, name: '', args: '' })
                  }
                  const acc = toolCallAccumulators.get(tcIndex)
                  if (tc.id) acc.id = tc.id
                  if (tc.function?.name) acc.name = tc.function.name
                  if (tc.function?.arguments) acc.args += tc.function.arguments
                }
              }

              if (finishReason) {
                if (blockStarted) {
                  sse({ type: 'content_block_stop', index: blockIndex })
                  blockIndex++
                  blockStarted = false
                }

                // Flush accumulated tool calls as Anthropic content blocks
                for (const [, tc] of toolCallAccumulators) {
                  let parsedInput = {}
                  try { parsedInput = JSON.parse(tc.args || '{}') } catch { parsedInput = { raw: tc.args } }
                  sse({ type: 'content_block_start', index: blockIndex, content_block: { type: 'tool_use', id: tc.id, name: tc.name, input: {} } })
                  sse({ type: 'content_block_delta', index: blockIndex, delta: { type: 'input_json_delta', partial_json: JSON.stringify(parsedInput) } })
                  sse({ type: 'content_block_stop', index: blockIndex })
                  blockIndex++
                }
                toolCallAccumulators.clear()

                let stopReason = 'end_turn'
                if (finishReason === 'tool_calls') stopReason = 'tool_use'
                else if (finishReason === 'length') stopReason = 'max_tokens'
                sse({ type: 'message_delta', delta: { stop_reason: stopReason }, usage: { output_tokens: chunk.usage?.completion_tokens || 0 } })
                sse({ type: 'message_stop' })
                sentStop = true
              }
            } catch {}
          }
        }
      } finally {
        reader.releaseLock()
      }

      if (!sentStop) {
        if (blockStarted) sse({ type: 'content_block_stop', index: blockIndex })
        sse({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 0 } })
        sse({ type: 'message_stop' })
      }
      res.end()
    } else {
      // Non-streaming
      const upstreamRes = await fetch(endpoint, {
        method: 'POST', headers,
        body: JSON.stringify(openaiReq)
      })

      if (!upstreamRes.ok) {
        const err = await upstreamRes.text()
        console.error(`[Adapter] Upstream error ${upstreamRes.status}:`, err.slice(0, 300))
        res.status(upstreamRes.status).json({ type: 'error', error: { message: err } })
        return
      }

      const openaiResp = await upstreamRes.json()
      res.json(translateResponse(openaiResp, model))
    }
  } catch (error) {
    console.error('[Adapter] Error:', error.message || error)
    res.status(500).json({ type: 'error', error: { message: String(error) } })
  }
})

app.post('/v1/messages/count_tokens', (req, res) => {
  const chars = JSON.stringify(req.body).length
  res.json({ input_tokens: Math.ceil(chars / 4) })
})

const server = app.listen(ADAPTER_PORT, async () => {
  console.log(`[Adapter] Running on http://localhost:${ADAPTER_PORT}`)
  console.log()

  const ADAPTER = `http://localhost:${ADAPTER_PORT}`
  let passed = 0
  let failed = 0

  async function test(name, fn) {
    try {
      await fn()
      console.log(`  ✓ ${name}`)
      passed++
    } catch (err) {
      console.error(`  ✗ ${name}: ${err.message}`)
      failed++
    }
  }

  // ============================================================================
  // Test 1: Kimi cloud — non-streaming
  // ============================================================================
  console.log('=== Test 1: Non-streaming text (Kimi cloud) ===')
  await test('Kimi cloud Anthropic Messages API', async () => {
    const res = await fetch(`${ADAPTER}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'test' },
      body: JSON.stringify({
        model: KIMI_CONFIG.modelId,
        messages: [{ role: 'user', content: 'Say just "hello" and nothing else. No explanation.' }],
        max_tokens: 500,
        temperature: 0.1
      })
    })

    const data = await res.json()
    console.log('    Response:', JSON.stringify(data).slice(0, 400))

    if (data.type !== 'message') throw new Error(`Expected type=message, got ${data.type}`)
    if (data.role !== 'assistant') throw new Error(`Expected role=assistant, got ${data.role}`)
    if (!data.content?.[0]?.text) throw new Error('No text content in response')
    if (!data.stop_reason) throw new Error('No stop_reason')
    console.log('    Text:', data.content[0].text.slice(0, 100))
  })

  // ============================================================================
  // Test 2: Kimi cloud — streaming (uses higher max_tokens since Kimi K2.5
  // emits reasoning_content tokens before actual content tokens)
  // ============================================================================
  console.log()
  console.log('=== Test 2: Streaming text (Kimi cloud) ===')
  await test('Kimi cloud streaming SSE', async () => {
    const res = await fetch(`${ADAPTER}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'test' },
      body: JSON.stringify({
        model: KIMI_CONFIG.modelId,
        messages: [{ role: 'user', content: 'Count from 1 to 3. Just the numbers, one per line.' }],
        max_tokens: 500,
        temperature: 0.1,
        stream: true
      })
    })

    const text = await res.text()
    const events = text.split('\n\n').filter(e => e.trim()).map(e => {
      const lines = e.split('\n')
      const eventLine = lines.find(l => l.startsWith('event:'))
      const dataLine = lines.find(l => l.startsWith('data:'))
      return { event: eventLine?.slice(7), data: dataLine ? JSON.parse(dataLine.slice(6)) : null }
    })

    const eventTypes = events.map(e => e.event)
    console.log('    Event types:', eventTypes.join(', '))

    if (!eventTypes.includes('message_start')) throw new Error('Missing message_start')
    if (!eventTypes.includes('message_stop')) throw new Error('Missing message_stop')

    // Check for content — Kimi may have reasoning_content only for short
    // prompts, or content_block_delta for actual output
    const hasDeltas = eventTypes.includes('content_block_delta')
    if (hasDeltas) {
      const fullText = events
        .filter(e => e.event === 'content_block_delta' && e.data?.delta?.type === 'text_delta')
        .map(e => e.data.delta.text).join('')
      console.log('    Streamed text:', fullText.slice(0, 200))
    } else {
      // With higher max_tokens, we should get content. Fail if not.
      throw new Error('Missing content_block_delta — model may have spent all tokens on reasoning')
    }
  })

  // ============================================================================
  // Test 3: Kimi cloud — tool calling
  // ============================================================================
  console.log()
  console.log('=== Test 3: Tool calling (Kimi cloud) ===')
  await test('Kimi cloud tool use', async () => {
    const res = await fetch(`${ADAPTER}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'test' },
      body: JSON.stringify({
        model: KIMI_CONFIG.modelId,
        messages: [{ role: 'user', content: 'Use the get_weather tool to check the weather in Tokyo.' }],
        max_tokens: 500,
        temperature: 0.1,
        tools: [{
          name: 'get_weather',
          description: 'Get the current weather for a city',
          input_schema: {
            type: 'object',
            properties: { city: { type: 'string', description: 'City name' } },
            required: ['city']
          }
        }]
      })
    })

    const data = await res.json()
    console.log('    Response:', JSON.stringify(data).slice(0, 500))

    if (data.type !== 'message') throw new Error(`Expected type=message, got ${data.type}`)
    const toolUse = data.content?.find(b => b.type === 'tool_use')
    if (toolUse) {
      console.log('    Tool use:', toolUse.name, JSON.stringify(toolUse.input))
      if (!toolUse.id) throw new Error('Tool use missing id')
      if (!toolUse.name) throw new Error('Tool use missing name')
    } else {
      console.log('    No tool use (model responded with text). Content:', data.content?.[0]?.text?.slice(0, 100))
    }
  })

  // ============================================================================
  // Test 4: Tool result round-trip (simulates SDK multi-turn tool calling)
  // ============================================================================
  console.log()
  console.log('=== Test 4: Tool result round-trip (Kimi cloud) ===')
  await test('Kimi cloud tool result round-trip', async () => {
    const res = await fetch(`${ADAPTER}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'test' },
      body: JSON.stringify({
        model: KIMI_CONFIG.modelId,
        messages: [
          { role: 'user', content: 'What is the weather in Paris?' },
          { role: 'assistant', content: [
            { type: 'text', text: 'Let me check the weather.' },
            { type: 'tool_use', id: 'toolu_001', name: 'get_weather', input: { city: 'Paris' } }
          ]},
          { role: 'user', content: [
            { type: 'tool_result', tool_use_id: 'toolu_001', content: 'Sunny, 22°C in Paris' }
          ]}
        ],
        max_tokens: 500,
        temperature: 0.1,
        tools: [{
          name: 'get_weather',
          description: 'Get the current weather for a city',
          input_schema: {
            type: 'object',
            properties: { city: { type: 'string', description: 'City name' } },
            required: ['city']
          }
        }]
      })
    })

    const data = await res.json()
    console.log('    Response:', JSON.stringify(data).slice(0, 400))

    if (data.type !== 'message') throw new Error(`Expected type=message, got ${data.type}`)
    if (!data.content?.[0]?.text) throw new Error('No text content in tool result follow-up')
    const text = data.content[0].text.toLowerCase()
    console.log('    Text:', data.content[0].text.slice(0, 200))
    // The model should reference the weather result
    if (!text.includes('paris') && !text.includes('sunny') && !text.includes('22')) {
      console.log('    Warning: Response may not reference tool result')
    }
  })

  // ============================================================================
  // Test 5: Token counting
  // ============================================================================
  console.log()
  console.log('=== Test 5: Token counting ===')
  await test('Count tokens', async () => {
    const res = await fetch(`${ADAPTER}/v1/messages/count_tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'test', messages: [{ role: 'user', content: 'Hello world' }] })
    })
    const data = await res.json()
    if (!data.input_tokens || data.input_tokens < 1) throw new Error('Expected positive token count')
    console.log('    Tokens:', data.input_tokens)
  })

  // ============================================================================
  // Results
  // ============================================================================
  console.log()
  console.log(`=== Results: ${passed} passed, ${failed} failed ===`)
  server.close()
  process.exit(failed > 0 ? 1 : 0)
})
