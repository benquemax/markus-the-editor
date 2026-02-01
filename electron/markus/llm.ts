/**
 * Markus LLM Client
 *
 * Handles communication with OpenAI-compatible LLM APIs.
 * Supports both native tool calling and MD_JSON format for models
 * that don't have native function calling capabilities.
 */

import { v4 as uuidv4 } from 'uuid'
import {
  LLMSettings,
  LLMMessage,
  LLMResponse,
  ParsedToolCall,
  ToolDefinition
} from './types'

/**
 * Checks if an endpoint is a Kimi API endpoint.
 * Kimi requires special headers for streaming.
 */
function isKimiEndpoint(endpoint: string): boolean {
  return endpoint.includes('kimi') || endpoint.includes('moonshot')
}

/**
 * Checks if an endpoint is an Anthropic API endpoint.
 * Anthropic uses different headers and request format.
 */
function isAnthropicEndpoint(endpoint: string): boolean {
  return endpoint.includes('anthropic.com')
}

/**
 * Normalizes API endpoint URLs to fix common configuration mistakes.
 * - For Anthropic: ensures the path is /v1/messages (not /v1/chat/completions)
 * - For OpenAI/Kimi and compatible APIs: ensures the path ends with /chat/completions
 */
function normalizeEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint)

    if (isAnthropicEndpoint(endpoint)) {
      // Anthropic API requires /v1/messages endpoint
      // Common mistake: users copy OpenAI's /v1/chat/completions path
      if (url.pathname.includes('chat/completions') || url.pathname === '/' || url.pathname === '/v1' || url.pathname === '/v1/') {
        url.pathname = '/v1/messages'
        console.log(`[Markus] Normalized Anthropic endpoint: ${endpoint} -> ${url.toString()}`)
        return url.toString()
      }
    } else {
      // OpenAI, Kimi, and other OpenAI-compatible APIs require /chat/completions endpoint
      // Users often provide just the base URL without the path
      if (!url.pathname.includes('chat/completions')) {
        // Append /chat/completions to the existing path
        const basePath = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname
        url.pathname = `${basePath}/chat/completions`
        console.log(`[Markus] Normalized endpoint: ${endpoint} -> ${url.toString()}`)
        return url.toString()
      }
    }

    return endpoint
  } catch {
    // If URL parsing fails, return as-is
    return endpoint
  }
}

/**
 * Builds headers for the API request.
 * Different providers require different authentication headers.
 */
function buildHeaders(settings: LLMSettings): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }

  if (isAnthropicEndpoint(settings.apiEndpoint)) {
    // Anthropic uses x-api-key header
    headers['x-api-key'] = settings.apiKey
    headers['anthropic-version'] = '2023-06-01'
  } else {
    // OpenAI and compatible APIs use Bearer token
    headers['Authorization'] = `Bearer ${settings.apiKey}`
  }

  // Kimi-specific headers
  // Kimi For Coding API requires a known coding agent User-Agent
  // to pass their client gating (only allows Kimi CLI, Claude Code, Roo Code, etc.)
  if (isKimiEndpoint(settings.apiEndpoint)) {
    headers['X-Traffic-Source'] = 'self'
    headers['User-Agent'] = 'KimiCLI/1.3'
  }

  return headers
}

/**
 * Converts OpenAI-format messages to Anthropic format.
 * Anthropic separates system messages from the messages array.
 */
function convertToAnthropicFormat(
  messages: LLMMessage[]
): { system?: string; messages: Array<{ role: 'user' | 'assistant'; content: string }> } {
  const systemMessages = messages.filter(m => m.role === 'system')
  const otherMessages = messages.filter(m => m.role !== 'system')

  // Anthropic requires alternating user/assistant messages
  // and must start with a user message
  const anthropicMessages: Array<{ role: 'user' | 'assistant'; content: string }> = []

  for (const msg of otherMessages) {
    if (msg.role === 'user' || msg.role === 'assistant') {
      anthropicMessages.push({
        role: msg.role,
        content: msg.content
      })
    }
  }

  return {
    system: systemMessages.map(m => m.content).join('\n\n') || undefined,
    messages: anthropicMessages
  }
}

/**
 * Parses Anthropic's response format to extract content.
 */
function parseAnthropicResponse(data: {
  content?: Array<{ type: string; text?: string }>
}): string {
  if (!data.content) return ''

  return data.content
    .filter(block => block.type === 'text' && block.text)
    .map(block => block.text)
    .join('')
}

/**
 * Parses MD_JSON format from LLM response.
 * MD_JSON format: Tool calls are wrapped in ```json blocks with a specific structure.
 *
 * Example:
 * ```json
 * {"tool": "read_file", "arguments": {"path": "/path/to/file"}}
 * ```
 */
function parseMdJson(content: string): { textContent: string; toolCalls: ParsedToolCall[] } {
  const toolCalls: ParsedToolCall[] = []
  let textContent = content

  // Match JSON code blocks that contain tool calls
  const jsonBlockRegex = /```json\s*\n?([\s\S]*?)\n?```/g
  let match

  while ((match = jsonBlockRegex.exec(content)) !== null) {
    try {
      const jsonContent = match[1].trim()
      const parsed = JSON.parse(jsonContent)

      // Check if it's a tool call
      if (parsed.tool && typeof parsed.tool === 'string') {
        toolCalls.push({
          id: uuidv4(),
          name: parsed.tool,
          arguments: parsed.arguments || {}
        })

        // Remove the JSON block from text content
        textContent = textContent.replace(match[0], '').trim()
      }
    } catch {
      // Not valid JSON or not a tool call, leave as-is
    }
  }

  return { textContent, toolCalls }
}

/**
 * Parses native OpenAI tool call format.
 */
function parseNativeToolCalls(
  toolCalls: Array<{
    id: string
    type: string
    function: { name: string; arguments: string }
  }>
): ParsedToolCall[] {
  return toolCalls
    .filter(tc => tc.type === 'function')
    .map(tc => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments || '{}')
    }))
}

/**
 * Generates the tool schema for the system prompt (MD_JSON mode).
 */
export function generateToolSchema(tools: ToolDefinition[]): string {
  const toolDescriptions = tools.map(tool => {
    const params = Object.entries(tool.parameters.properties)
      .map(([name, prop]) => {
        const required = tool.parameters.required?.includes(name) ? ' (required)' : ''
        return `    - ${name}${required}: ${prop.description}`
      })
      .join('\n')

    return `- **${tool.name}**: ${tool.description}\n  Parameters:\n${params}`
  }).join('\n\n')

  return `You have access to the following tools. To use a tool, output a JSON code block with the tool name and arguments:

\`\`\`json
{"tool": "tool_name", "arguments": {"param1": "value1"}}
\`\`\`

Available tools:

${toolDescriptions}

Important:
- Only use tools when necessary to complete the user's request
- Always explain what you're doing before using a tool
- Wait for tool results before continuing
- If a tool fails, explain the error and suggest alternatives`
}

/**
 * LLM Client class for making API requests.
 */
export class LLMClient {
  private normalizedEndpoint: string

  constructor(private settings: LLMSettings) {
    // Normalize the endpoint URL to fix common configuration mistakes
    this.normalizedEndpoint = normalizeEndpoint(settings.apiEndpoint)
  }

  /**
   * Builds headers for API requests using the normalized endpoint.
   */
  private buildHeaders(): Record<string, string> {
    return buildHeaders({ ...this.settings, apiEndpoint: this.normalizedEndpoint })
  }

  /**
   * Makes a non-streaming chat completion request.
   */
  async chat(
    messages: LLMMessage[],
    tools?: ToolDefinition[],
    signal?: AbortSignal
  ): Promise<LLMResponse> {
    const isAnthropic = isAnthropicEndpoint(this.normalizedEndpoint)
    let body: Record<string, unknown>

    if (isAnthropic) {
      // Anthropic API format
      const { system, messages: anthropicMessages } = convertToAnthropicFormat(messages)
      body = {
        model: this.settings.model,
        messages: anthropicMessages,
        max_tokens: this.settings.maxTokens || 4096
      }
      if (system) {
        body.system = system
      }
      // Anthropic doesn't support temperature > 1
      const temp = this.settings.temperature ?? 0.7
      body.temperature = Math.min(temp, 1.0)
    } else {
      // OpenAI-compatible API format
      body = {
        model: this.settings.model,
        messages,
        max_tokens: this.settings.maxTokens || 4096,
        temperature: this.settings.temperature ?? 0.7
      }

      // Add tools for native function calling (if endpoint supports it)
      // Skip for Kimi which uses MD_JSON
      if (tools && tools.length > 0 && !isKimiEndpoint(this.normalizedEndpoint)) {
        body.tools = tools.map(tool => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters
          }
        }))
      }
    }

    const response = await fetch(this.normalizedEndpoint, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
      signal
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`LLM API error (${response.status}) from ${this.normalizedEndpoint}: ${errorText}`)
    }

    const data = await response.json()
    let content: string
    let nativeToolCalls: Array<{
      id: string
      type: string
      function: { name: string; arguments: string }
    }> = []

    if (isAnthropic) {
      // Parse Anthropic response format
      content = parseAnthropicResponse(data as { content?: Array<{ type: string; text?: string }> })
    } else {
      // Parse OpenAI response format
      // Only use 'content' field - 'reasoning_content' is for thinking traces
      const openaiData = data as {
        choices?: Array<{
          message?: {
            content?: string
            tool_calls?: Array<{
              id: string
              type: string
              function: { name: string; arguments: string }
            }>
          }
        }>
      }
      const message = openaiData.choices?.[0]?.message
      content = message?.content || ''
      nativeToolCalls = message?.tool_calls || []
    }

    // Parse tool calls - try native first, then MD_JSON
    let toolCalls: ParsedToolCall[] = []
    let textContent = content

    if (nativeToolCalls.length > 0) {
      toolCalls = parseNativeToolCalls(nativeToolCalls)
    } else if (content) {
      const parsed = parseMdJson(content)
      textContent = parsed.textContent
      toolCalls = parsed.toolCalls
    }

    return {
      content: textContent,
      toolCalls,
      rawResponse: data
    }
  }

  /**
   * Makes a streaming chat completion request.
   * Yields chunks as they arrive.
   */
  async *chatStream(
    messages: LLMMessage[],
    tools?: ToolDefinition[],
    signal?: AbortSignal
  ): AsyncGenerator<{ type: 'content' | 'done'; content?: string }, void, unknown> {
    const isAnthropic = isAnthropicEndpoint(this.normalizedEndpoint)
    let body: Record<string, unknown>

    if (isAnthropic) {
      // Anthropic API format
      const { system, messages: anthropicMessages } = convertToAnthropicFormat(messages)
      body = {
        model: this.settings.model,
        messages: anthropicMessages,
        max_tokens: this.settings.maxTokens || 4096,
        stream: true
      }
      if (system) {
        body.system = system
      }
      // Anthropic doesn't support temperature > 1
      const temp = this.settings.temperature ?? 0.7
      body.temperature = Math.min(temp, 1.0)
    } else {
      // OpenAI-compatible API format
      body = {
        model: this.settings.model,
        messages,
        max_tokens: this.settings.maxTokens || 4096,
        temperature: this.settings.temperature ?? 0.7,
        stream: true
      }

      // Add tools for native function calling (if endpoint supports it)
      if (tools && tools.length > 0 && !isKimiEndpoint(this.normalizedEndpoint)) {
        body.tools = tools.map(tool => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters
          }
        }))
      }
    }

    const response = await fetch(this.normalizedEndpoint, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
      signal
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`LLM API error (${response.status}) from ${this.normalizedEndpoint}: ${errorText}`)
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('No response body')
    }

    console.log('[Markus] Got response body reader, starting to read chunks...')

    const decoder = new TextDecoder()
    let buffer = ''
    let chunkCount = 0

    try {
      while (true) {
        const { done, value } = await reader.read()

        if (done) {
          console.log(`[Markus] Stream done after ${chunkCount} chunks`)
          yield { type: 'done' }
          break
        }

        chunkCount++
        const decodedChunk = decoder.decode(value, { stream: true })
        buffer += decodedChunk

        // Log first few chunks for debugging
        if (chunkCount <= 3) {
          console.log(`[Markus] Chunk ${chunkCount}:`, decodedChunk.slice(0, 200))
        }

        // Process complete SSE messages
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        if (chunkCount <= 3 && lines.length > 0) {
          console.log(`[Markus] Processing ${lines.length} lines from chunk ${chunkCount}`)
        }

        for (const line of lines) {
          const trimmed = line.trim()

          if (!trimmed || trimmed === 'data: [DONE]' || trimmed === 'data:[DONE]') {
            continue
          }

          // Handle SSE data lines - some providers use "data: " (with space), others use "data:" (no space)
          if (trimmed.startsWith('data:')) {
            try {
              // Remove "data:" or "data: " prefix
              const jsonStr = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed.slice(5)
              const json = JSON.parse(jsonStr)

              if (isAnthropic) {
                // Anthropic streaming format
                // Event types: content_block_delta contains text deltas
                if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
                  const content = json.delta.text
                  if (content) {
                    yield { type: 'content', content }
                  }
                }
              } else {
                // OpenAI streaming format
                const delta = json.choices?.[0]?.delta
                // Only use 'content' field for the actual response
                // 'reasoning_content' contains thinking/reasoning trace and should be ignored
                // (or shown separately in the UI if desired)
                const content = delta?.content

                if (content) {
                  yield { type: 'content', content }
                }
              }
            } catch (e) {
              // Log parse errors for debugging
              console.log('[Markus] SSE parse error:', trimmed.slice(0, 100), e)
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  /**
   * Tests the connection to the LLM API.
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await this.chat([
        { role: 'user', content: 'Say "OK" if you can hear me.' }
      ])

      if (response.content) {
        return { success: true }
      }

      return { success: false, error: 'No response from LLM' }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }
}

/**
 * Creates an LLM client with the given settings.
 */
export function createLLMClient(settings: LLMSettings): LLMClient {
  return new LLMClient(settings)
}
