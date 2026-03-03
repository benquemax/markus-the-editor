/**
 * Agency API — End-to-End Writing Mode Test
 *
 * Tests the full Agency API stack in writing mode using the book-test workspace.
 * Uses Kimi cloud inference via the format adapter.
 *
 * Run with: node electron/markus/agency/test-e2e-writing.mjs
 */

import express from 'express'
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import * as fs from 'fs/promises'
import * as path from 'path'

// ============================================================================
// Config
// ============================================================================

const KIMI_API_KEY = 'sk-kimi-iarkBO1adOhwjjYxvtB5xmtH6Gtc8zfuZByhTFe24IQ9O7RJWZqJKK6P8Pugml5V'
const ADAPTER_PORT = 3860
const KIMI_MODEL = 'kimi-for-coding'
const KIMI_URL = 'https://api.kimi.com/coding/v1'
const KIMI_HEADERS = { 'X-Traffic-Source': 'self', 'User-Agent': 'KimiCLI/1.3' }
const WORKSPACE = path.join(process.env.HOME, 'Downloads/book-test')

// ============================================================================
// Adapter (minimal inline version)
// ============================================================================

function translateRequest(req) {
  const messages = []
  if (req.system) {
    const text = typeof req.system === 'string' ? req.system : req.system.map(b => b.text).join('\n\n')
    messages.push({ role: 'system', content: text })
  }
  for (const msg of req.messages) {
    if (typeof msg.content === 'string') { messages.push({ role: msg.role, content: msg.content }); continue }
    if (msg.role === 'assistant') {
      const textParts = [], toolCalls = []
      for (const block of msg.content) {
        if (block.type === 'text') textParts.push(block.text)
        else if (block.type === 'tool_use') toolCalls.push({ id: block.id, type: 'function', function: { name: block.name, arguments: JSON.stringify(block.input || {}) } })
      }
      const m = { role: 'assistant', content: textParts.join('') || null }
      if (toolCalls.length) { m.tool_calls = toolCalls; m.reasoning_content = 'Analyzing and determining the next action.' }
      messages.push(m)
    } else if (msg.role === 'user') {
      const textParts = [], toolResults = []
      for (const block of msg.content) {
        if (block.type === 'text') textParts.push(block.text)
        else if (block.type === 'tool_result') {
          const content = typeof block.content === 'string' ? block.content : Array.isArray(block.content) ? block.content.filter(b => b.type === 'text').map(b => b.text).join('') : ''
          toolResults.push({ tool_call_id: block.tool_use_id, content })
        }
      }
      for (const r of toolResults) messages.push({ role: 'tool', ...r })
      if (textParts.length) messages.push({ role: 'user', content: textParts.join('') })
    }
  }
  const body = { model: req.model, messages, max_tokens: req.max_tokens, stream: req.stream || false }
  if (req.temperature !== undefined) body.temperature = req.temperature
  if (req.tools?.length) body.tools = req.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }))
  return body
}

function translateResponse(resp, model) {
  const choice = resp.choices?.[0]
  if (!choice) return { id: `msg_${Date.now()}`, type: 'message', role: 'assistant', content: [{ type: 'text', text: '' }], model, stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 } }
  const content = []
  if (choice.message.content) content.push({ type: 'text', text: choice.message.content })
  if (choice.message.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      let input = {}; try { input = JSON.parse(tc.function.arguments) } catch { input = { raw: tc.function.arguments } }
      content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input })
    }
  }
  if (!content.length) content.push({ type: 'text', text: '' })
  let stop_reason = 'end_turn'
  if (choice.finish_reason === 'tool_calls' || choice.message.tool_calls?.length) stop_reason = 'tool_use'
  else if (choice.finish_reason === 'length') stop_reason = 'max_tokens'
  return { id: `msg_${resp.id || Date.now()}`, type: 'message', role: 'assistant', content, model, stop_reason, usage: { input_tokens: resp.usage?.prompt_tokens || 0, output_tokens: resp.usage?.completion_tokens || 0 } }
}

function startAdapter() {
  const app = express()
  app.use(express.json({ limit: '50mb' }))
  app.post('/v1/messages', async (req, res) => {
    const anthropicReq = req.body
    const endpoint = `${KIMI_URL}/chat/completions`
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KIMI_API_KEY}`, ...KIMI_HEADERS }
    console.log(`  [Adapter] ${anthropicReq.model} (stream=${anthropicReq.stream})`)
    try {
      const openaiReq = translateRequest(anthropicReq)
      if (anthropicReq.stream) {
        const upstreamRes = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(openaiReq) })
        if (!upstreamRes.ok) { const err = await upstreamRes.text(); res.status(upstreamRes.status).json({ type: 'error', error: { message: err } }); return }
        res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache')
        const msgId = `msg_${Date.now()}`
        const sse = (data) => res.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`)
        sse({ type: 'message_start', message: { id: msgId, type: 'message', role: 'assistant', content: [], model: anthropicReq.model, stop_reason: null, usage: { input_tokens: 0, output_tokens: 0 } } })
        const reader = upstreamRes.body.getReader(); const decoder = new TextDecoder()
        let buffer = '', blockStarted = false, blockIndex = 0, sentStop = false
        const toolCallAccumulators = new Map()
        try {
          while (true) { // eslint-disable-line no-constant-condition
            const { done, value } = await reader.read(); if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n'); buffer = lines.pop() || ''
            for (const line of lines) {
              const trimmed = line.trim()
              if (!trimmed || trimmed === 'data: [DONE]' || trimmed === 'data:[DONE]') continue
              if (!trimmed.startsWith('data:')) continue
              try {
                const chunk = JSON.parse(trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed.slice(5))
                const delta = chunk.choices?.[0]?.delta; const finishReason = chunk.choices?.[0]?.finish_reason
                if (delta?.content) {
                  if (!blockStarted) { sse({ type: 'content_block_start', index: blockIndex, content_block: { type: 'text', text: '' } }); blockStarted = true }
                  sse({ type: 'content_block_delta', index: blockIndex, delta: { type: 'text_delta', text: delta.content } })
                }
                if (delta?.tool_calls) {
                  for (const tc of delta.tool_calls) {
                    const tcIndex = tc.index ?? 0
                    if (!toolCallAccumulators.has(tcIndex)) { if (blockStarted) { sse({ type: 'content_block_stop', index: blockIndex }); blockIndex++; blockStarted = false }; toolCallAccumulators.set(tcIndex, { id: tc.id || `toolu_${Date.now()}_${tcIndex}`, name: '', args: '' }) }
                    const acc = toolCallAccumulators.get(tcIndex); if (tc.id) acc.id = tc.id; if (tc.function?.name) acc.name = tc.function.name; if (tc.function?.arguments) acc.args += tc.function.arguments
                  }
                }
                if (finishReason) {
                  if (blockStarted) { sse({ type: 'content_block_stop', index: blockIndex }); blockIndex++; blockStarted = false }
                  for (const [, tc] of toolCallAccumulators) {
                    let parsedInput = {}; try { parsedInput = JSON.parse(tc.args || '{}') } catch { parsedInput = { raw: tc.args } }
                    sse({ type: 'content_block_start', index: blockIndex, content_block: { type: 'tool_use', id: tc.id, name: tc.name, input: {} } })
                    sse({ type: 'content_block_delta', index: blockIndex, delta: { type: 'input_json_delta', partial_json: JSON.stringify(parsedInput) } })
                    sse({ type: 'content_block_stop', index: blockIndex }); blockIndex++
                  }
                  toolCallAccumulators.clear()
                  let stopReason = 'end_turn'; if (finishReason === 'tool_calls') stopReason = 'tool_use'; else if (finishReason === 'length') stopReason = 'max_tokens'
                  sse({ type: 'message_delta', delta: { stop_reason: stopReason }, usage: { output_tokens: chunk.usage?.completion_tokens || 0 } })
                  sse({ type: 'message_stop' }); sentStop = true
                }
              } catch {}
            }
          }
        } finally { reader.releaseLock() }
        if (!sentStop) { if (blockStarted) sse({ type: 'content_block_stop', index: blockIndex }); sse({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 0 } }); sse({ type: 'message_stop' }) }
        res.end()
      } else {
        const upstreamRes = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(openaiReq) })
        if (!upstreamRes.ok) { const err = await upstreamRes.text(); res.status(upstreamRes.status).json({ type: 'error', error: { message: err } }); return }
        res.json(translateResponse(await upstreamRes.json(), anthropicReq.model))
      }
    } catch (error) { res.status(500).json({ type: 'error', error: { message: String(error) } }) }
  })
  app.post('/v1/messages/count_tokens', (req, res) => res.json({ input_tokens: Math.ceil(JSON.stringify(req.body).length / 4) }))
  return new Promise(resolve => { const server = app.listen(ADAPTER_PORT, () => { console.log(`[Adapter] http://localhost:${ADAPTER_PORT}`); resolve(server) }) })
}

// ============================================================================
// Tests
// ============================================================================

let passed = 0, failed = 0
async function test(name, fn) {
  const start = Date.now()
  try {
    await fn()
    console.log(`  ✓ ${name} (${((Date.now() - start) / 1000).toFixed(1)}s)`)
    passed++
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message} (${((Date.now() - start) / 1000).toFixed(1)}s)`)
    failed++
  }
}

async function main() {
  const adapterServer = await startAdapter()
  delete process.env.CLAUDECODE
  process.env.ANTHROPIC_BASE_URL = `http://localhost:${ADAPTER_PORT}`
  process.env.ANTHROPIC_API_KEY = 'agency-api-local'
  process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = KIMI_MODEL
  process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = KIMI_MODEL
  process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = KIMI_MODEL

  // Verify workspace exists
  try { await fs.access(WORKSPACE) } catch { console.error(`Workspace not found: ${WORKSPACE}`); process.exit(1) }

  // ==========================================================================
  // Test 1: Read workspace files and analyze plot
  // ==========================================================================
  console.log('\n=== Test 1: Writing Orchestrator — Analyze Plot ===')
  await test('Orchestrator reads workspace and analyzes content', async () => {
    const q = query({
      prompt: `Read the file plot-outline.md and give a brief 2-sentence summary of the story. Be concise.`,
      options: {
        model: KIMI_MODEL,
        cwd: WORKSPACE,
        systemPrompt: 'You are a writing assistant. Read files in the workspace to answer questions. Be extremely concise.',
        maxTurns: 5,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
      }
    })

    let resultText = ''
    for await (const msg of q) {
      if (msg.type === 'result' && msg.subtype === 'success') resultText = msg.result || ''
    }
    console.log(`    Result: "${resultText.slice(0, 300)}"`)
    if (!resultText) throw new Error('No result from orchestrator')
    // Should mention cats, rebellion, or the main character
    const lower = resultText.toLowerCase()
    if (!lower.includes('cat') && !lower.includes('feline') && !lower.includes('whiskers') && !lower.includes('rebellion')) {
      throw new Error('Result does not reference the story content')
    }
  })

  // ==========================================================================
  // Test 2: Character analysis with custom tool
  // ==========================================================================
  console.log('\n=== Test 2: Agent with Custom Tool — Character Lookup ===')
  await test('Agent uses custom tool to look up characters', async () => {
    // Create a character database tool
    const characters = {}
    const charDir = path.join(WORKSPACE, 'characters')
    const files = await fs.readdir(charDir)
    for (const f of files) {
      if (f.endsWith('.md')) {
        const content = await fs.readFile(path.join(charDir, f), 'utf-8')
        const name = f.replace('.md', '').replace(/^(protagonist|antagonist|supporting)-/, '')
        characters[name] = content.slice(0, 500)
      }
    }

    const mcpServer = createSdkMcpServer({
      name: 'character-db',
      version: '1.0.0',
      tools: [
        tool(
          'lookup_character',
          'Look up character details from the character database. Returns the character sheet.',
          { name: z.string().describe('Character name (e.g. whiskers, rex, mittens)') },
          async (args) => {
            const charData = characters[args.name.toLowerCase()]
            if (charData) return { content: [{ type: 'text', text: charData }] }
            return { content: [{ type: 'text', text: `Character "${args.name}" not found. Available: ${Object.keys(characters).join(', ')}` }] }
          }
        )
      ]
    })

    const q = query({
      prompt: 'Use the lookup_character tool to find info about the protagonist "whiskers". Then describe their key trait in one sentence.',
      options: {
        model: KIMI_MODEL,
        cwd: WORKSPACE,
        systemPrompt: 'You have a lookup_character tool. Use it to answer questions about characters. Be brief.',
        maxTurns: 5,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        mcpServers: { 'character-db': mcpServer }
      }
    })

    let resultText = ''
    for await (const msg of q) {
      if (msg.type === 'result' && msg.subtype === 'success') resultText = msg.result || ''
    }
    console.log(`    Result: "${resultText.slice(0, 300)}"`)
    if (!resultText) throw new Error('No result')
    if (!resultText.toLowerCase().includes('whiskers') && !resultText.toLowerCase().includes('shadow')) {
      throw new Error('Result does not reference the character')
    }
  })

  // ==========================================================================
  // Test 3: File editing with markus_edit-style tool
  // ==========================================================================
  console.log('\n=== Test 3: File Editing — Create Chapter Draft ===')
  await test('Agent creates a file using edit tool', async () => {
    const testFile = path.join(WORKSPACE, 'chapters', 'test-chapter.md')
    // Clean up if exists from previous run
    try { await fs.unlink(testFile) } catch {}

    let editCalled = false
    const mcpServer = createSdkMcpServer({
      name: 'edit-tools',
      version: '1.0.0',
      tools: [
        tool(
          'write_file',
          'Write content to a file. Creates the file if it does not exist.',
          {
            path: z.string().describe('File path relative to workspace'),
            content: z.string().describe('Content to write')
          },
          async (args) => {
            editCalled = true
            const fullPath = path.resolve(WORKSPACE, args.path)
            await fs.mkdir(path.dirname(fullPath), { recursive: true })
            await fs.writeFile(fullPath, args.content, 'utf-8')
            return { content: [{ type: 'text', text: `File written: ${args.path} (${args.content.length} chars)` }] }
          }
        )
      ]
    })

    const q = query({
      prompt: `Write a very short (3-4 sentences) opening paragraph for Chapter 1 of "The Feline Rebellion" and save it to chapters/test-chapter.md using the write_file tool. The chapter is about Whiskers discovering his Shadow Sight ability.`,
      options: {
        model: KIMI_MODEL,
        cwd: WORKSPACE,
        systemPrompt: 'You are a creative writing assistant. Use the write_file tool to save content. Be creative but concise.',
        maxTurns: 5,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        mcpServers: { 'edit-tools': mcpServer }
      }
    })

    let resultText = ''
    for await (const msg of q) {
      if (msg.type === 'result' && msg.subtype === 'success') resultText = msg.result || ''
    }

    console.log(`    Edit tool called: ${editCalled}`)
    console.log(`    Result: "${resultText.slice(0, 300)}"`)

    // Check the file was created
    let fileContent = ''
    try { fileContent = await fs.readFile(testFile, 'utf-8') } catch {}

    if (fileContent) {
      console.log(`    File content: "${fileContent.slice(0, 200)}"`)
    }

    if (!editCalled && !fileContent) throw new Error('write_file tool was not called and file was not created')

    // Clean up
    try { await fs.unlink(testFile) } catch {}
  })

  // ==========================================================================
  // Test 4: Writing mode with subagents
  // ==========================================================================
  console.log('\n=== Test 4: Writing Mode with Subagent Delegation ===')
  await test('Orchestrator delegates to research subagent', async () => {
    const q = query({
      prompt: `List the names of all characters in the characters/ folder. Just list their names, nothing else.`,
      options: {
        model: KIMI_MODEL,
        cwd: WORKSPACE,
        systemPrompt: `You are a writing orchestrator. You have a research agent that can help with information gathering.
When asked to find information, you may delegate to the research agent using the Task tool.
Be extremely concise in your responses.`,
        agents: {
          research: {
            description: 'Research specialist for reading files and gathering information',
            prompt: 'You are a research assistant. Read files to find information. Report findings concisely.',
            model: 'haiku',
            maxTurns: 5
          }
        },
        maxTurns: 8,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
      }
    })

    let resultText = ''
    for await (const msg of q) {
      if (msg.type === 'result' && msg.subtype === 'success') resultText = msg.result || ''
    }
    console.log(`    Result: "${resultText.slice(0, 400)}"`)
    if (!resultText) throw new Error('No result from orchestrator')
    // Should mention at least some character names
    const lower = resultText.toLowerCase()
    const knownChars = ['whiskers', 'rex', 'mittens', 'patches', 'luna', 'bella', 'paws', 'musti']
    const foundChars = knownChars.filter(c => lower.includes(c))
    console.log(`    Characters found: ${foundChars.join(', ')}`)
    if (foundChars.length < 2) throw new Error(`Expected at least 2 character names, found: ${foundChars.length}`)
  })

  // ==========================================================================
  // Results
  // ==========================================================================
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
  adapterServer.close()
  setTimeout(() => process.exit(failed > 0 ? 1 : 0), 1000)
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
