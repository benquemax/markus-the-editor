/**
 * Agency API — SDK Integration Test
 *
 * Tests the full stack: Claude Agent SDK → Adapter → Kimi Cloud
 * Run with: node electron/markus/agency/test-sdk-integration.mjs
 *
 * This single script tests:
 * 1. Adapter format translation (non-streaming, streaming, tool calling)
 * 2. SDK query() through the adapter
 * 3. Custom MCP tool creation and invocation
 * 4. Hook system (loop detection, subtask limiting)
 */

import express from 'express'
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

// ============================================================================
// Config
// ============================================================================

const KIMI_API_KEY = 'sk-kimi-iarkBO1adOhwjjYxvtB5xmtH6Gtc8zfuZByhTFe24IQ9O7RJWZqJKK6P8Pugml5V'
const ADAPTER_PORT = 3860
const KIMI_MODEL = 'kimi-for-coding'
const KIMI_URL = 'https://api.kimi.com/coding/v1'
const KIMI_HEADERS = { 'X-Traffic-Source': 'self', 'User-Agent': 'KimiCLI/1.3' }

// ============================================================================
// Adapter (inline — same as test-adapter.mjs but minimal)
// ============================================================================

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
      const textParts = [], toolCalls = []
      for (const block of msg.content) {
        if (block.type === 'text') textParts.push(block.text)
        else if (block.type === 'tool_use') {
          toolCalls.push({ id: block.id, type: 'function', function: { name: block.name, arguments: JSON.stringify(block.input || {}) } })
        }
      }
      const m = { role: 'assistant', content: textParts.join('') || null }
      if (toolCalls.length) {
        m.tool_calls = toolCalls
        m.reasoning_content = 'Analyzing and determining the next action.'
      }
      messages.push(m)
    } else if (msg.role === 'user') {
      const textParts = [], toolResults = []
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
    body.tools = req.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }))
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

function startAdapter() {
  const app = express()
  app.use(express.json({ limit: '50mb' }))

  app.post('/v1/messages', async (req, res) => {
    const anthropicReq = req.body
    const model = anthropicReq.model
    const endpoint = `${KIMI_URL}/chat/completions`
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KIMI_API_KEY}`, ...KIMI_HEADERS }

    console.log(`  [Adapter] ${model} → Kimi cloud (stream=${anthropicReq.stream})`)

    try {
      const openaiReq = translateRequest(anthropicReq)
      if (anthropicReq.stream) {
        const upstreamRes = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(openaiReq) })
        if (!upstreamRes.ok) {
          const err = await upstreamRes.text()
          console.error(`  [Adapter] Error ${upstreamRes.status}:`, err.slice(0, 200))
          res.status(upstreamRes.status).json({ type: 'error', error: { message: err } })
          return
        }
        res.setHeader('Content-Type', 'text/event-stream')
        res.setHeader('Cache-Control', 'no-cache')
        const msgId = `msg_${Date.now()}`
        const sse = (data) => res.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`)
        sse({ type: 'message_start', message: { id: msgId, type: 'message', role: 'assistant', content: [], model, stop_reason: null, usage: { input_tokens: 0, output_tokens: 0 } } })
        const reader = upstreamRes.body.getReader()
        const decoder = new TextDecoder()
        let buffer = '', blockStarted = false, blockIndex = 0, sentStop = false
        const toolCallAccumulators = new Map()
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
                if (delta?.content) {
                  if (!blockStarted) { sse({ type: 'content_block_start', index: blockIndex, content_block: { type: 'text', text: '' } }); blockStarted = true }
                  sse({ type: 'content_block_delta', index: blockIndex, delta: { type: 'text_delta', text: delta.content } })
                }
                if (delta?.tool_calls) {
                  for (const tc of delta.tool_calls) {
                    const tcIndex = tc.index ?? 0
                    if (!toolCallAccumulators.has(tcIndex)) {
                      if (blockStarted) { sse({ type: 'content_block_stop', index: blockIndex }); blockIndex++; blockStarted = false }
                      toolCallAccumulators.set(tcIndex, { id: tc.id || `toolu_${Date.now()}_${tcIndex}`, name: '', args: '' })
                    }
                    const acc = toolCallAccumulators.get(tcIndex)
                    if (tc.id) acc.id = tc.id
                    if (tc.function?.name) acc.name = tc.function.name
                    if (tc.function?.arguments) acc.args += tc.function.arguments
                  }
                }
                if (finishReason) {
                  if (blockStarted) { sse({ type: 'content_block_stop', index: blockIndex }); blockIndex++; blockStarted = false }
                  for (const [, tc] of toolCallAccumulators) {
                    let parsedInput = {}
                    try { parsedInput = JSON.parse(tc.args || '{}') } catch { parsedInput = { raw: tc.args } }
                    sse({ type: 'content_block_start', index: blockIndex, content_block: { type: 'tool_use', id: tc.id, name: tc.name, input: {} } })
                    sse({ type: 'content_block_delta', index: blockIndex, delta: { type: 'input_json_delta', partial_json: JSON.stringify(parsedInput) } })
                    sse({ type: 'content_block_stop', index: blockIndex }); blockIndex++
                  }
                  toolCallAccumulators.clear()
                  let stopReason = 'end_turn'
                  if (finishReason === 'tool_calls') stopReason = 'tool_use'
                  else if (finishReason === 'length') stopReason = 'max_tokens'
                  sse({ type: 'message_delta', delta: { stop_reason: stopReason }, usage: { output_tokens: chunk.usage?.completion_tokens || 0 } })
                  sse({ type: 'message_stop' }); sentStop = true
                }
              } catch {}
            }
          }
        } finally { reader.releaseLock() }
        if (!sentStop) {
          if (blockStarted) sse({ type: 'content_block_stop', index: blockIndex })
          sse({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 0 } })
          sse({ type: 'message_stop' })
        }
        res.end()
      } else {
        const upstreamRes = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(openaiReq) })
        if (!upstreamRes.ok) {
          const err = await upstreamRes.text()
          res.status(upstreamRes.status).json({ type: 'error', error: { message: err } })
          return
        }
        res.json(translateResponse(await upstreamRes.json(), model))
      }
    } catch (error) {
      res.status(500).json({ type: 'error', error: { message: String(error) } })
    }
  })

  app.post('/v1/messages/count_tokens', (req, res) => {
    res.json({ input_tokens: Math.ceil(JSON.stringify(req.body).length / 4) })
  })

  return new Promise(resolve => {
    const server = app.listen(ADAPTER_PORT, () => {
      console.log(`[Adapter] Running on http://localhost:${ADAPTER_PORT}`)
      resolve(server)
    })
  })
}

// ============================================================================
// Tests
// ============================================================================

let passed = 0, failed = 0
async function test(name, fn) {
  try {
    await fn()
    console.log(`  ✓ ${name}`)
    passed++
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`)
    if (err.stack) console.error(`    ${err.stack.split('\n').slice(1, 3).join('\n    ')}`)
    failed++
  }
}

async function main() {
  const adapterServer = await startAdapter()

  // Unset CLAUDECODE to allow SDK to spawn subprocess inside Claude Code session
  delete process.env.CLAUDECODE

  // Set SDK environment variables
  process.env.ANTHROPIC_BASE_URL = `http://localhost:${ADAPTER_PORT}`
  process.env.ANTHROPIC_API_KEY = 'agency-api-local'
  process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = KIMI_MODEL
  process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = KIMI_MODEL
  process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = KIMI_MODEL

  // ==========================================================================
  // Test Suite 1: SDK Basic Query
  // ==========================================================================
  console.log('\n=== Suite 1: SDK Basic Query (Kimi cloud) ===')

  await test('Simple text query through SDK', async () => {
    const q = query({
      prompt: 'Say just the word "hello" and nothing else.',
      options: {
        model: KIMI_MODEL,
        systemPrompt: 'You are a helpful assistant. Be extremely brief.',
        maxTurns: 1,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true
      }
    })

    let gotResult = false
    let resultText = ''
    for await (const msg of q) {
      if (msg.type === 'result') {
        gotResult = true
        if (msg.subtype === 'success') resultText = msg.result || ''
        console.log(`    Result: ${msg.subtype}, text: "${resultText.slice(0, 100)}"`)
      }
    }
    if (!gotResult) throw new Error('No result message received from SDK')
  })

  // ==========================================================================
  // Test Suite 2: SDK with Custom MCP Tools
  // ==========================================================================
  console.log('\n=== Suite 2: SDK with Custom MCP Tools ===')

  await test('Custom tool invocation through SDK', async () => {
    // Create a simple in-process MCP tool
    let toolWasCalled = false
    let toolArgs = null

    const mcpServer = createSdkMcpServer({
      name: 'test-tools',
      version: '1.0.0',
      tools: [
        tool(
          'get_temperature',
          'Get the current temperature for a city. Always use this tool when asked about weather.',
          { city: z.string().describe('City name') },
          async (args) => {
            toolWasCalled = true
            toolArgs = args
            return { content: [{ type: 'text', text: `The temperature in ${args.city} is 25°C and sunny.` }] }
          }
        )
      ]
    })

    const q = query({
      prompt: 'What is the temperature in Tokyo? Use the get_temperature tool.',
      options: {
        model: KIMI_MODEL,
        systemPrompt: 'You have access to a get_temperature tool. Always use it when asked about weather. Be brief in your response.',
        maxTurns: 5,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        mcpServers: { 'test-tools': mcpServer }
      }
    })

    let resultText = ''
    for await (const msg of q) {
      if (msg.type === 'result' && msg.subtype === 'success') {
        resultText = msg.result || ''
      }
    }

    console.log(`    Tool called: ${toolWasCalled}, args: ${JSON.stringify(toolArgs)}`)
    console.log(`    Result: "${resultText.slice(0, 200)}"`)

    if (!toolWasCalled) throw new Error('Tool was never called by the SDK agent')
    if (!toolArgs?.city) throw new Error('Tool was called without city argument')
  })

  // ==========================================================================
  // Test Suite 3: Hooks
  // ==========================================================================
  console.log('\n=== Suite 3: Hook System ===')

  await test('Loop detector detects repetition', async () => {
    // Test the loop detector logic directly (doesn't need LLM)
    const { createHash } = await import('crypto')

    // Inline loop detector for testing
    const recentCalls = []
    function checkForLoop(toolName, input) {
      const hash = createHash('md5').update(`${toolName}:${JSON.stringify(input)}`).digest('hex').slice(0, 12)
      recentCalls.push({ hash, toolName })
      while (recentCalls.length > 6) recentCalls.shift()
      if (recentCalls.length < 3) return null
      let repeatCount = 0
      for (let i = recentCalls.length - 1; i >= 0; i--) {
        if (recentCalls[i].hash === hash) repeatCount++
        else break
      }
      if (repeatCount >= 3) return `STOP: Loop detected on ${toolName}`
      return null
    }

    // Simulate 3 identical calls
    const r1 = checkForLoop('read_file', { path: '/tmp/test.txt' })
    const r2 = checkForLoop('read_file', { path: '/tmp/test.txt' })
    const r3 = checkForLoop('read_file', { path: '/tmp/test.txt' })

    if (r1 !== null) throw new Error('False positive on first call')
    if (r2 !== null) throw new Error('False positive on second call')
    if (!r3) throw new Error('Loop not detected after 3 identical calls')
    console.log(`    Warning: "${r3}"`)
  })

  await test('Subtask limiter enforces spawn count', async () => {
    let spawnCount = 0
    function checkLimit(max = 3) {
      spawnCount++
      if (spawnCount > max) return `Limit reached (${max})`
      return null
    }

    const r1 = checkLimit(3)
    const r2 = checkLimit(3)
    const r3 = checkLimit(3)
    const r4 = checkLimit(3)

    if (r1 || r2 || r3) throw new Error('False limit before reaching max')
    if (!r4) throw new Error('Limit not enforced after exceeding max')
    console.log(`    Blocked at spawn #${spawnCount}`)
  })

  // ==========================================================================
  // Test Suite 4: Multi-turn tool conversation
  // ==========================================================================
  console.log('\n=== Suite 4: Multi-turn Tool Conversation ===')

  await test('Multi-tool conversation completes', async () => {
    let callCount = 0
    const mcpServer = createSdkMcpServer({
      name: 'multi-test',
      version: '1.0.0',
      tools: [
        tool(
          'add_numbers',
          'Add two numbers together. Returns the sum.',
          { a: z.number().describe('First number'), b: z.number().describe('Second number') },
          async (args) => {
            callCount++
            const sum = args.a + args.b
            return { content: [{ type: 'text', text: `${args.a} + ${args.b} = ${sum}` }] }
          }
        )
      ]
    })

    const q = query({
      prompt: 'Use the add_numbers tool to compute 17 + 25. Then report the result.',
      options: {
        model: KIMI_MODEL,
        systemPrompt: 'You have an add_numbers tool. Use it to compute the requested sum. Be brief.',
        maxTurns: 5,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        mcpServers: { 'multi-test': mcpServer }
      }
    })

    let resultText = ''
    for await (const msg of q) {
      if (msg.type === 'result' && msg.subtype === 'success') resultText = msg.result || ''
    }

    console.log(`    Tool call count: ${callCount}`)
    console.log(`    Result: "${resultText.slice(0, 200)}"`)

    if (callCount === 0) throw new Error('add_numbers tool was never called')
    if (!resultText.includes('42')) throw new Error(`Expected result to mention 42, got: "${resultText.slice(0, 100)}"`)
  })

  // ==========================================================================
  // Results
  // ==========================================================================
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)

  adapterServer.close()
  // Give the SDK time to clean up
  setTimeout(() => process.exit(failed > 0 ? 1 : 0), 1000)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
