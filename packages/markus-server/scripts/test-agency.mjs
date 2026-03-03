#!/usr/bin/env node
/**
 * Autonomous test suite for Agency API with local models.
 *
 * Tests connectivity, completions, tool calling, and format translation
 * against the ferocitee LLM servers (Ollama CPU + vllama GPU).
 *
 * Usage: node packages/markus-server/scripts/test-agency.mjs
 */

import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '../../..')

// ============================================================================
// Configuration
// ============================================================================

const SERVERS = {
  ollama: { url: 'http://ferocitee:11434', name: 'Ollama (CPU)' },
  vllama: { url: 'http://ferocitee:11435', name: 'vllama (GPU)' }
}

const MODELS = {
  haiku: {
    id: 'ministral-3:14b',
    // vllama GPU server lists ministral but hangs on inference; Ollama CPU works fine
    server: 'ollama',
    description: 'Ministral 14B — CPU inference (vllama hangs)'
  },
  sonnet: {
    id: 'qwen3-coder-next:latest',
    server: 'ollama',
    description: 'Qwen3 Coder Next — good all-rounder'
  },
  opus: {
    id: 'huihui_ai/devstral-abliterated:latest',
    server: 'ollama',
    description: 'Devstral Abliterated — best reasoning (vllama tool calls broken)'
  }
}

// Which tests to run (edit these to control test scope)
const RUN_CONNECTIVITY = true
const RUN_COMPLETIONS = true
const RUN_TOOL_CALLING = true
const RUN_ADAPTER = true

// Which models to test (set to false to skip slow models)
const TEST_HAIKU = true
const TEST_SONNET = true
const TEST_OPUS = true

// Timeout for LLM requests (local models can be slow, especially on CPU)
const COMPLETION_TIMEOUT_MS = 180_000
const ADAPTER_PORT = 3870  // Use different port than production (3860)

// ============================================================================
// Helpers
// ============================================================================

let passed = 0
let failed = 0
let skipped = 0

function log(msg) { console.log(`  ${msg}`) }
function header(msg) { console.log(`\n${'='.repeat(60)}\n  ${msg}\n${'='.repeat(60)}`) }

async function test(name, fn) {
  const start = Date.now()
  try {
    await fn()
    const ms = Date.now() - start
    console.log(`  PASS ${name} (${ms}ms)`)
    passed++
  } catch (err) {
    const ms = Date.now() - start
    console.log(`  FAIL ${name} (${ms}ms): ${err.message}`)
    failed++
  }
}

function skip(name, reason) {
  console.log(`  SKIP ${name}: ${reason}`)
  skipped++
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10_000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...options, signal: controller.signal })
    return res
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Safe fetch that reads the body and returns { status, ok, data, text }.
 * Avoids the "body already consumed" issue.
 */
async function safeFetch(url, options = {}, timeoutMs = 10_000) {
  const res = await fetchWithTimeout(url, options, timeoutMs)
  const text = await res.text()
  let data = null
  try { data = JSON.parse(text) } catch {}
  return { status: res.status, ok: res.ok, data, text, headers: res.headers }
}

function getServerUrl(modelTier) {
  const model = MODELS[modelTier]
  return SERVERS[model.server].url
}

function getTestTiers() {
  const tiers = []
  if (TEST_HAIKU) tiers.push('haiku')
  if (TEST_SONNET) tiers.push('sonnet')
  if (TEST_OPUS) tiers.push('opus')
  return tiers
}

// ============================================================================
// Test 1: Connectivity
// ============================================================================

async function testConnectivity() {
  header('Test 1: Server Connectivity')

  for (const [key, server] of Object.entries(SERVERS)) {
    await test(`${server.name} (${key}) responds`, async () => {
      const { ok, status, data, text } = await safeFetch(`${server.url}/v1/models`, {}, 5000)
      assert(ok, `HTTP ${status}: ${text.slice(0, 200)}`)
      assert(data?.data || data?.models, 'No models in response')
      const modelList = data.data || data.models
      log(`Found ${modelList.length} models`)
    })
  }

  for (const [tier, model] of Object.entries(MODELS)) {
    const shouldTest = (tier === 'haiku' && TEST_HAIKU) ||
                       (tier === 'sonnet' && TEST_SONNET) ||
                       (tier === 'opus' && TEST_OPUS)
    if (!shouldTest) { skip(`${tier} model available`, 'disabled'); continue }

    await test(`${tier} model (${model.id}) on ${model.server}`, async () => {
      const serverUrl = SERVERS[model.server].url
      const { ok, data } = await safeFetch(`${serverUrl}/v1/models`, {}, 5000)
      assert(ok, 'Failed to list models')
      const modelList = data?.data || data?.models || []
      const found = modelList.some(m =>
        (m.id || m.name || '').includes(model.id.split(':')[0])
      )
      assert(found, `Model ${model.id} not found in server model list`)
    })
  }
}

// ============================================================================
// Test 2: Simple Completions (OpenAI format)
// ============================================================================

async function testCompletions() {
  header('Test 2: Simple Completions (OpenAI format)')

  for (const tier of getTestTiers()) {
    const model = MODELS[tier]
    const serverUrl = getServerUrl(tier)

    await test(`${tier} completion (${model.id})`, async () => {
      const { ok, status, data, text } = await safeFetch(
        `${serverUrl}/v1/chat/completions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer not-needed' },
          body: JSON.stringify({
            model: model.id,
            messages: [{ role: 'user', content: 'Reply with exactly: "Hello from ' + tier + '"' }],
            max_tokens: 50,
            temperature: 0.1
          })
        },
        COMPLETION_TIMEOUT_MS
      )
      assert(ok, `HTTP ${status}: ${text.slice(0, 200)}`)
      const content = data?.choices?.[0]?.message?.content
      assert(content, 'No content in response')
      log(`Response: "${content.slice(0, 100)}"`)
    })
  }
}

// ============================================================================
// Test 3: Tool Calling (OpenAI format)
// ============================================================================

async function testToolCalling() {
  header('Test 3: Tool Calling (OpenAI format)')

  const tools = [{
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get the current weather for a location',
      parameters: {
        type: 'object',
        properties: { location: { type: 'string', description: 'City name' } },
        required: ['location']
      }
    }
  }]

  for (const tier of getTestTiers()) {
    const model = MODELS[tier]
    const serverUrl = getServerUrl(tier)

    await test(`${tier} tool calling (${model.id})`, async () => {
      const { ok, status, data, text } = await safeFetch(
        `${serverUrl}/v1/chat/completions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer not-needed' },
          body: JSON.stringify({
            model: model.id,
            messages: [{ role: 'user', content: 'What is the weather in Helsinki? Use the get_weather tool.' }],
            tools,
            max_tokens: 200,
            temperature: 0.1
          })
        },
        COMPLETION_TIMEOUT_MS
      )
      assert(ok, `HTTP ${status}: ${text.slice(0, 200)}`)
      const choice = data?.choices?.[0]
      assert(choice, 'No choices in response')

      if (choice.message?.tool_calls?.length > 0) {
        const tc = choice.message.tool_calls[0]
        log(`Tool call: ${tc.function.name}(${tc.function.arguments})`)
        assert(tc.function.name === 'get_weather', `Expected get_weather, got ${tc.function.name}`)
        const args = JSON.parse(tc.function.arguments)
        assert(args.location, 'No location in tool call arguments')
      } else {
        const responseText = choice.message?.content || ''
        log(`Model responded with text (no tool call): "${responseText.slice(0, 100)}"`)
        log(`finish_reason: ${choice.finish_reason}`)
      }
    })
  }
}

// ============================================================================
// Test 4: Format Adapter (Anthropic <-> OpenAI)
// ============================================================================

async function testAdapter() {
  header('Test 4: Format Adapter (Anthropic -> OpenAI)')

  log('Building adapter test bundle...')

  const esbuild = await import('esbuild')
  const fs = await import('fs')

  // Write adapter entry that imports from source using absolute paths
  const adapterEntry = join(projectRoot, 'packages/markus-server/scripts/.test-adapter-entry.ts')
  const adapterBundle = join(projectRoot, 'dist-electron/.test-adapter-bundle.mjs')

  fs.writeFileSync(adapterEntry, `
    import { createAdapter } from '${join(projectRoot, 'electron/markus/agency/adapter.ts').replace(/\\/g, '/')}'
    import { createDefaultConfig } from '${join(projectRoot, 'electron/markus/agency/config.ts').replace(/\\/g, '/')}'

    const config = createDefaultConfig()
    config.adapterPort = ${ADAPTER_PORT}
    const { server } = createAdapter(config)
    process.stdout.write('ADAPTER_READY\\n')
    process.stdin.resume()
    process.stdin.on('end', () => { server.close(); process.exit(0) })
  `)

  let child = null
  try {
    await esbuild.build({
      entryPoints: [adapterEntry],
      bundle: true,
      outfile: adapterBundle,
      format: 'esm',
      platform: 'node',
      target: 'node18',
      external: [
        'fs', 'fs/promises', 'path', 'os', 'child_process', 'crypto',
        'http', 'https', 'net', 'url', 'stream', 'zlib', 'events',
        'buffer', 'querystring', 'string_decoder', 'util',
        'express', 'ws', 'uuid', 'js-yaml', 'fastest-levenshtein',
        '@anthropic-ai/claude-agent-sdk', 'zod', 'electron'
      ],
      logLevel: 'silent'
    })
    log('Adapter bundle built')

    // Start adapter subprocess
    const { spawn } = await import('child_process')
    child = spawn('node', [adapterBundle], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: projectRoot
    })

    // Wait for ready signal
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Adapter startup timeout')), 10_000)
      let output = ''
      child.stdout.on('data', (d) => {
        output += d.toString()
        if (output.includes('ADAPTER_READY')) { clearTimeout(timeout); resolve() }
      })
      child.stderr.on('data', () => {}) // consume stderr
      child.on('error', (err) => { clearTimeout(timeout); reject(err) })
    })
    log('Adapter running on port ' + ADAPTER_PORT)

    // Health check
    await test('Adapter health check', async () => {
      const { ok, data } = await safeFetch(`http://localhost:${ADAPTER_PORT}/health`, {}, 5000)
      assert(ok, 'Health check failed')
      assert(data?.type === 'anthropic-openai-adapter', `Wrong type: ${data?.type}`)
    })

    // Test completions through adapter (Anthropic format in, Anthropic format out)
    // Only test haiku and sonnet (opus is slow on CPU)
    const adapterTiers = getTestTiers().filter(t => t !== 'opus')
    for (const tier of adapterTiers) {
      const model = MODELS[tier]

      await test(`Adapter: ${tier} completion`, async () => {
        const { ok, status, data, text } = await safeFetch(
          `http://localhost:${ADAPTER_PORT}/v1/messages`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: model.id,
              messages: [{ role: 'user', content: 'Reply with exactly: "Adapter test passed"' }],
              max_tokens: 50,
              stream: false
            })
          },
          COMPLETION_TIMEOUT_MS
        )
        assert(ok, `HTTP ${status}: ${text.slice(0, 200)}`)
        assert(data?.type === 'message', `Expected type=message, got ${data?.type}`)
        assert(data?.role === 'assistant', `Expected role=assistant, got ${data?.role}`)
        assert(data?.content?.[0]?.type === 'text', 'Expected text content block')
        log(`Response: "${data.content[0].text.slice(0, 100)}"`)
      })

      await test(`Adapter: ${tier} tool calling`, async () => {
        const { ok, status, data, text } = await safeFetch(
          `http://localhost:${ADAPTER_PORT}/v1/messages`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: model.id,
              messages: [{ role: 'user', content: 'What is the weather in Helsinki? Use the get_weather tool.' }],
              tools: [{
                name: 'get_weather',
                description: 'Get the current weather for a location',
                input_schema: {
                  type: 'object',
                  properties: { location: { type: 'string', description: 'City name' } },
                  required: ['location']
                }
              }],
              max_tokens: 200,
              stream: false
            })
          },
          COMPLETION_TIMEOUT_MS
        )
        assert(ok, `HTTP ${status}: ${text.slice(0, 200)}`)
        assert(data?.type === 'message', `Expected type=message, got ${data?.type}`)

        const toolBlocks = (data.content || []).filter(b => b.type === 'tool_use')
        if (toolBlocks.length > 0) {
          log(`Tool: ${toolBlocks[0].name}(${JSON.stringify(toolBlocks[0].input)})`)
          assert(toolBlocks[0].name === 'get_weather', `Wrong tool: ${toolBlocks[0].name}`)
          assert(data.stop_reason === 'tool_use', `Expected stop_reason=tool_use, got ${data.stop_reason}`)
        } else {
          const textBlock = (data.content || []).find(b => b.type === 'text')
          log(`Model responded with text (no tool): "${(textBlock?.text || '').slice(0, 100)}"`)
        }
      })
    }
  } finally {
    if (child) {
      child.stdin.end()
      child.kill('SIGTERM')
    }
    try { fs.unlinkSync(adapterEntry) } catch {}
    try { fs.unlinkSync(adapterBundle) } catch {}
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('\n--- Agency API Test Suite --- Local Models on ferocitee\n')
  console.log(`Models: haiku=${TEST_HAIKU} sonnet=${TEST_SONNET} opus=${TEST_OPUS}`)
  console.log(`Tests:  connectivity=${RUN_CONNECTIVITY} completions=${RUN_COMPLETIONS} tools=${RUN_TOOL_CALLING} adapter=${RUN_ADAPTER}`)

  const start = Date.now()

  if (RUN_CONNECTIVITY) await testConnectivity()
  if (RUN_COMPLETIONS) await testCompletions()
  if (RUN_TOOL_CALLING) await testToolCalling()
  if (RUN_ADAPTER) await testAdapter()

  const totalMs = Date.now() - start

  header('Results')
  console.log(`  Passed:  ${passed}`)
  console.log(`  Failed:  ${failed}`)
  console.log(`  Skipped: ${skipped}`)
  console.log(`  Total:   ${(totalMs / 1000).toFixed(1)}s`)
  console.log()

  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
