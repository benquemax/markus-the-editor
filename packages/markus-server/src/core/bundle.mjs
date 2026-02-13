// ../../node_modules/uuid/dist-node/stringify.js
var byteToHex = [];
for (let i = 0; i < 256; ++i) {
  byteToHex.push((i + 256).toString(16).slice(1));
}
function unsafeStringify(arr, offset = 0) {
  return (byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + "-" + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + "-" + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + "-" + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + "-" + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]]).toLowerCase();
}

// ../../node_modules/uuid/dist-node/rng.js
import { randomFillSync } from "node:crypto";
var rnds8Pool = new Uint8Array(256);
var poolPtr = rnds8Pool.length;
function rng() {
  if (poolPtr > rnds8Pool.length - 16) {
    randomFillSync(rnds8Pool);
    poolPtr = 0;
  }
  return rnds8Pool.slice(poolPtr, poolPtr += 16);
}

// ../../node_modules/uuid/dist-node/native.js
import { randomUUID } from "node:crypto";
var native_default = { randomUUID };

// ../../node_modules/uuid/dist-node/v4.js
function _v4(options, buf, offset) {
  options = options || {};
  const rnds = options.random ?? options.rng?.() ?? rng();
  if (rnds.length < 16) {
    throw new Error("Random bytes length must be >= 16");
  }
  rnds[6] = rnds[6] & 15 | 64;
  rnds[8] = rnds[8] & 63 | 128;
  if (buf) {
    offset = offset || 0;
    if (offset < 0 || offset + 16 > buf.length) {
      throw new RangeError(`UUID byte range ${offset}:${offset + 15} is out of buffer bounds`);
    }
    for (let i = 0; i < 16; ++i) {
      buf[offset + i] = rnds[i];
    }
    return buf;
  }
  return unsafeStringify(rnds);
}
function v4(options, buf, offset) {
  if (native_default.randomUUID && !buf && !options) {
    return native_default.randomUUID();
  }
  return _v4(options, buf, offset);
}
var v4_default = v4;

// ../../electron/markus/llm.ts
function isKimiEndpoint(endpoint) {
  return endpoint.includes("kimi") || endpoint.includes("moonshot");
}
function isAnthropicEndpoint(endpoint) {
  return endpoint.includes("anthropic.com");
}
function normalizeEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    if (isAnthropicEndpoint(endpoint)) {
      if (url.pathname.includes("chat/completions") || url.pathname === "/" || url.pathname === "/v1" || url.pathname === "/v1/") {
        url.pathname = "/v1/messages";
        console.log(`[Markus] Normalized Anthropic endpoint: ${endpoint} -> ${url.toString()}`);
        return url.toString();
      }
    } else {
      if (!url.pathname.includes("chat/completions")) {
        const basePath = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
        url.pathname = `${basePath}/chat/completions`;
        console.log(`[Markus] Normalized endpoint: ${endpoint} -> ${url.toString()}`);
        return url.toString();
      }
    }
    return endpoint;
  } catch {
    return endpoint;
  }
}
function buildHeaders(settings) {
  const headers = {
    "Content-Type": "application/json"
  };
  if (isAnthropicEndpoint(settings.apiEndpoint)) {
    headers["x-api-key"] = settings.apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers["Authorization"] = `Bearer ${settings.apiKey}`;
  }
  if (isKimiEndpoint(settings.apiEndpoint)) {
    headers["X-Traffic-Source"] = "self";
    headers["User-Agent"] = "KimiCLI/1.3";
  }
  return headers;
}
function convertToAnthropicFormat(messages) {
  const systemMessages = messages.filter((m) => m.role === "system");
  const otherMessages = messages.filter((m) => m.role !== "system");
  const anthropicMessages = [];
  for (const msg of otherMessages) {
    if (msg.role === "user" || msg.role === "assistant") {
      anthropicMessages.push({
        role: msg.role,
        content: msg.content
      });
    }
  }
  return {
    system: systemMessages.map((m) => m.content).join("\n\n") || void 0,
    messages: anthropicMessages
  };
}
function parseAnthropicResponse(data) {
  if (!data.content) return "";
  return data.content.filter((block) => block.type === "text" && block.text).map((block) => block.text).join("");
}
function parseMdJson(content) {
  const toolCalls = [];
  let textContent = content;
  const jsonBlockRegex = /```json\s*\n?([\s\S]*?)\n?```/g;
  let match;
  while ((match = jsonBlockRegex.exec(content)) !== null) {
    try {
      const jsonContent = match[1].trim();
      const parsed = JSON.parse(jsonContent);
      if (parsed.tool && typeof parsed.tool === "string") {
        toolCalls.push({
          id: v4_default(),
          name: parsed.tool,
          arguments: parsed.arguments || {}
        });
        textContent = textContent.replace(match[0], "").trim();
      }
    } catch {
    }
  }
  return { textContent, toolCalls };
}
function parseNativeToolCalls(toolCalls) {
  return toolCalls.filter((tc) => tc.type === "function").map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: JSON.parse(tc.function.arguments || "{}")
  }));
}
function generateToolSchema(tools) {
  const toolDescriptions = tools.map((tool) => {
    const params = Object.entries(tool.parameters.properties).map(([name, prop]) => {
      const required = tool.parameters.required?.includes(name) ? " (required)" : "";
      return `    - ${name}${required}: ${prop.description}`;
    }).join("\n");
    return `- **${tool.name}**: ${tool.description}
  Parameters:
${params}`;
  }).join("\n\n");
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
- If a tool fails, explain the error and suggest alternatives`;
}
var LLMClient = class {
  constructor(settings) {
    this.settings = settings;
    this.normalizedEndpoint = normalizeEndpoint(settings.apiEndpoint);
  }
  normalizedEndpoint;
  /**
   * Builds headers for API requests using the normalized endpoint.
   */
  buildHeaders() {
    return buildHeaders({ ...this.settings, apiEndpoint: this.normalizedEndpoint });
  }
  /**
   * Makes a non-streaming chat completion request.
   */
  async chat(messages, tools, signal) {
    const isAnthropic = isAnthropicEndpoint(this.normalizedEndpoint);
    let body;
    if (isAnthropic) {
      const { system, messages: anthropicMessages } = convertToAnthropicFormat(messages);
      body = {
        model: this.settings.model,
        messages: anthropicMessages,
        max_tokens: this.settings.maxTokens || 4096
      };
      if (system) {
        body.system = system;
      }
      const temp = this.settings.temperature ?? 0.7;
      body.temperature = Math.min(temp, 1);
    } else {
      body = {
        model: this.settings.model,
        messages,
        max_tokens: this.settings.maxTokens || 4096,
        temperature: this.settings.temperature ?? 0.7
      };
      if (tools && tools.length > 0 && !isKimiEndpoint(this.normalizedEndpoint)) {
        body.tools = tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters
          }
        }));
      }
    }
    const response = await fetch(this.normalizedEndpoint, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
      signal
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM API error (${response.status}) from ${this.normalizedEndpoint}: ${errorText}`);
    }
    const data = await response.json();
    let content;
    let nativeToolCalls = [];
    if (isAnthropic) {
      content = parseAnthropicResponse(data);
    } else {
      const openaiData = data;
      const message = openaiData.choices?.[0]?.message;
      content = message?.content || "";
      nativeToolCalls = message?.tool_calls || [];
    }
    let toolCalls = [];
    let textContent = content;
    if (nativeToolCalls.length > 0) {
      toolCalls = parseNativeToolCalls(nativeToolCalls);
    } else if (content) {
      const parsed = parseMdJson(content);
      textContent = parsed.textContent;
      toolCalls = parsed.toolCalls;
    }
    return {
      content: textContent,
      toolCalls,
      rawResponse: data
    };
  }
  /**
   * Makes a streaming chat completion request.
   * Yields chunks as they arrive.
   */
  async *chatStream(messages, tools, signal) {
    const isAnthropic = isAnthropicEndpoint(this.normalizedEndpoint);
    let body;
    if (isAnthropic) {
      const { system, messages: anthropicMessages } = convertToAnthropicFormat(messages);
      body = {
        model: this.settings.model,
        messages: anthropicMessages,
        max_tokens: this.settings.maxTokens || 4096,
        stream: true
      };
      if (system) {
        body.system = system;
      }
      const temp = this.settings.temperature ?? 0.7;
      body.temperature = Math.min(temp, 1);
    } else {
      body = {
        model: this.settings.model,
        messages,
        max_tokens: this.settings.maxTokens || 4096,
        temperature: this.settings.temperature ?? 0.7,
        stream: true
      };
      if (tools && tools.length > 0 && !isKimiEndpoint(this.normalizedEndpoint)) {
        body.tools = tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters
          }
        }));
      }
    }
    const response = await fetch(this.normalizedEndpoint, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
      signal
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM API error (${response.status}) from ${this.normalizedEndpoint}: ${errorText}`);
    }
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body");
    }
    console.log("[Markus] Got response body reader, starting to read chunks...");
    const decoder = new TextDecoder();
    let buffer = "";
    let chunkCount = 0;
    const CHUNK_TIMEOUT_MS = 6e4;
    try {
      while (true) {
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error("Stream timeout: no data received for 60 seconds")), CHUNK_TIMEOUT_MS);
        });
        const { done, value } = await Promise.race([
          reader.read(),
          timeoutPromise
        ]);
        if (done) {
          console.log(`[Markus] Stream done after ${chunkCount} chunks`);
          yield { type: "done" };
          break;
        }
        chunkCount++;
        const decodedChunk = decoder.decode(value, { stream: true });
        buffer += decodedChunk;
        if (chunkCount <= 3) {
          console.log(`[Markus] Chunk ${chunkCount}:`, decodedChunk.slice(0, 200));
        }
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        if (chunkCount <= 3 && lines.length > 0) {
          console.log(`[Markus] Processing ${lines.length} lines from chunk ${chunkCount}`);
        }
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === "data: [DONE]" || trimmed === "data:[DONE]") {
            continue;
          }
          if (trimmed.startsWith("data:")) {
            try {
              const jsonStr = trimmed.startsWith("data: ") ? trimmed.slice(6) : trimmed.slice(5);
              const json = JSON.parse(jsonStr);
              if (isAnthropic) {
                if (json.type === "content_block_delta" && json.delta?.type === "text_delta") {
                  const content = json.delta.text;
                  if (content) {
                    yield { type: "content", content };
                  }
                }
              } else {
                const delta = json.choices?.[0]?.delta;
                const content = delta?.content;
                if (content) {
                  yield { type: "content", content };
                }
              }
            } catch (e) {
              console.log("[Markus] SSE parse error:", trimmed.slice(0, 100), e);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
  /**
   * Tests the connection to the LLM API.
   */
  async testConnection() {
    try {
      const response = await this.chat([
        { role: "user", content: 'Say "OK" if you can hear me.' }
      ]);
      if (response.content) {
        return { success: true };
      }
      return { success: false, error: "No response from LLM" };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
};
function createLLMClient(settings) {
  return new LLMClient(settings);
}

// ../../electron/markus/tools.ts
import fs11 from "fs/promises";
import path7 from "path";
import { existsSync as existsSync7 } from "fs";

// ../../electron/markus/security.ts
import path from "path";
import { existsSync, statSync } from "fs";
var PathSecurityError = class extends Error {
  constructor(attemptedPath, reason) {
    super(`Access denied: ${reason}`);
    this.attemptedPath = attemptedPath;
    this.reason = reason;
    this.name = "PathSecurityError";
  }
};
function normalizePath(inputPath) {
  const absolutePath = path.isAbsolute(inputPath) ? inputPath : path.resolve(inputPath);
  return path.normalize(absolutePath);
}
function isPathInAllowedDirs(filePath, allowedDirs) {
  const normalizedPath = normalizePath(filePath);
  for (const allowedDir of allowedDirs) {
    const normalizedAllowedDir = normalizePath(allowedDir);
    const dirWithSep = normalizedAllowedDir.endsWith(path.sep) ? normalizedAllowedDir : normalizedAllowedDir + path.sep;
    if (normalizedPath === normalizedAllowedDir || normalizedPath.startsWith(dirWithSep)) {
      return true;
    }
  }
  return false;
}
function validateReadPath(filePath, allowedDirs) {
  const normalizedPath = normalizePath(filePath);
  if (allowedDirs.length === 0) {
    throw new PathSecurityError(filePath, "No workspace folders are open");
  }
  if (!isPathInAllowedDirs(normalizedPath, allowedDirs)) {
    throw new PathSecurityError(
      filePath,
      `Path is outside allowed workspace directories: ${allowedDirs.join(", ")}`
    );
  }
  return normalizedPath;
}
function validateWritePath(filePath, allowedDirs) {
  const normalizedPath = normalizePath(filePath);
  if (allowedDirs.length === 0) {
    throw new PathSecurityError(filePath, "No workspace folders are open");
  }
  if (!isPathInAllowedDirs(normalizedPath, allowedDirs)) {
    throw new PathSecurityError(
      filePath,
      `Path is outside allowed workspace directories: ${allowedDirs.join(", ")}`
    );
  }
  const parentDir = path.dirname(normalizedPath);
  if (!existsSync(parentDir)) {
    throw new PathSecurityError(filePath, `Parent directory does not exist: ${parentDir}`);
  }
  return normalizedPath;
}
function validateDirectoryPath(dirPath, allowedDirs) {
  const normalizedPath = normalizePath(dirPath);
  if (allowedDirs.length === 0) {
    throw new PathSecurityError(dirPath, "No workspace folders are open");
  }
  if (!isPathInAllowedDirs(normalizedPath, allowedDirs)) {
    throw new PathSecurityError(
      dirPath,
      `Path is outside allowed workspace directories: ${allowedDirs.join(", ")}`
    );
  }
  return normalizedPath;
}
function isFile(filePath) {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}
function isDirectory(dirPath) {
  try {
    return existsSync(dirPath) && statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}
function validateEditOperation(filePath, oldString, fileContent) {
  let count = 0;
  let pos = 0;
  while ((pos = fileContent.indexOf(oldString, pos)) !== -1) {
    count++;
    pos += oldString.length;
  }
  if (count === 0) {
    return {
      valid: false,
      error: `The string to replace was not found in ${filePath}`,
      occurrences: 0
    };
  }
  return {
    valid: true,
    occurrences: count
  };
}

// ../../electron/markus/agents/eventBus.ts
var AgentEventBus = class {
  subscriptions = /* @__PURE__ */ new Map();
  subscriptionIdCounter = 0;
  /**
   * Subscribe to an event type.
   * Returns an unsubscribe function.
   */
  on(event, handler) {
    const id = `sub_${++this.subscriptionIdCounter}`;
    const subscription = { event, handler, id };
    const existing = this.subscriptions.get(event) || [];
    existing.push(subscription);
    this.subscriptions.set(event, existing);
    return () => {
      const subs = this.subscriptions.get(event);
      if (subs) {
        const index = subs.findIndex((s) => s.id === id);
        if (index >= 0) {
          subs.splice(index, 1);
        }
      }
    };
  }
  /**
   * Subscribe to an event type for a single emission.
   * Automatically unsubscribes after the first event.
   */
  once(event, handler) {
    const unsubscribe = this.on(event, (data) => {
      unsubscribe();
      handler(data);
    });
    return unsubscribe;
  }
  /**
   * Emit an event to all subscribers.
   */
  emit(event, data) {
    const subs = this.subscriptions.get(event);
    if (subs) {
      for (const sub of subs) {
        try {
          sub.handler(data);
        } catch (error) {
          console.error(`[EventBus] Error in handler for ${String(event)}:`, error);
        }
      }
    }
  }
  /**
   * Remove all subscriptions for a specific event type.
   */
  removeAllListeners(event) {
    if (event) {
      this.subscriptions.delete(event);
    } else {
      this.subscriptions.clear();
    }
  }
  /**
   * Get the number of subscribers for an event type.
   */
  listenerCount(event) {
    return this.subscriptions.get(event)?.length || 0;
  }
  /**
   * Wait for an event with optional timeout.
   * Returns a promise that resolves with the event data.
   */
  waitFor(event, timeout) {
    return new Promise((resolve, reject) => {
      let timeoutId;
      const unsubscribe = this.once(event, (data) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        resolve(data);
      });
      if (timeout) {
        timeoutId = setTimeout(() => {
          unsubscribe();
          reject(new Error(`Timeout waiting for event: ${String(event)}`));
        }, timeout);
      }
    });
  }
  /**
   * Wait for an event that matches a predicate.
   */
  waitForMatch(event, predicate, timeout) {
    return new Promise((resolve, reject) => {
      let timeoutId;
      const unsubscribe = this.on(event, (data) => {
        if (predicate(data)) {
          unsubscribe();
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          resolve(data);
        }
      });
      if (timeout) {
        timeoutId = setTimeout(() => {
          unsubscribe();
          reject(new Error(`Timeout waiting for matching event: ${String(event)}`));
        }, timeout);
      }
    });
  }
};
var agentEventBus = new AgentEventBus();

// ../../electron/markus/agents/contextManager.ts
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}
var DEFAULT_CONTEXT_BUDGETS = {
  orchestrator: 8192,
  // Needs more context for coordination
  editor: 4096,
  // Focused on specific file edits
  research: 6144,
  // Needs room for search results
  critique: 6144,
  // Needs to see content being reviewed
  style: 4096,
  // Focused on specific passages
  creative: 6144
  // Needs room for ideation
};
var AgentContextManager = class {
  contexts = /* @__PURE__ */ new Map();
  workspaceFolders = [];
  constructor(workspaceFolders = []) {
    this.workspaceFolders = workspaceFolders;
  }
  /**
   * Update the workspace folders.
   */
  setWorkspaceFolders(folders) {
    this.workspaceFolders = folders;
    for (const context of this.contexts.values()) {
      context.workspaceFolders = folders;
    }
  }
  /**
   * Get or create a context for an agent.
   */
  getContext(agent, settings) {
    let context = this.contexts.get(agent);
    if (!context) {
      const maxTokens = settings?.maxTokens || DEFAULT_CONTEXT_BUDGETS[agent];
      const systemPrompt = this.buildSystemPrompt(agent);
      context = {
        agent,
        maxContextTokens: maxTokens,
        currentTokens: estimateTokens(systemPrompt),
        systemPrompt,
        messages: [],
        tools: this.getAgentTools(agent),
        workspaceFolders: this.workspaceFolders,
        relevantFiles: []
      };
      this.contexts.set(agent, context);
    }
    return context;
  }
  /**
   * Add a message to an agent's context.
   * Automatically manages context window size.
   */
  addMessage(agent, message) {
    const context = this.getContext(agent);
    const tokens = estimateTokens(message.content);
    const fullMessage = {
      ...message,
      tokens
    };
    const newTotal = context.currentTokens + tokens;
    if (newTotal > context.maxContextTokens) {
      this.trimContext(agent, tokens);
    }
    context.messages.push(fullMessage);
    context.currentTokens += tokens;
  }
  /**
   * Trim context to make room for new content.
   * Uses a sliding window approach, keeping recent messages.
   */
  trimContext(agent, neededTokens) {
    const context = this.contexts.get(agent);
    if (!context) return;
    const targetTokens = context.maxContextTokens - neededTokens;
    const systemPromptTokens = estimateTokens(context.systemPrompt);
    while (context.messages.length > 0 && context.currentTokens > targetTokens) {
      const removed = context.messages.shift();
      if (removed) {
        context.currentTokens -= removed.tokens;
      }
    }
    context.currentTokens = Math.max(context.currentTokens, systemPromptTokens);
  }
  /**
   * Add relevant files to an agent's context.
   */
  addRelevantFiles(agent, files) {
    const context = this.getContext(agent);
    for (const file of files) {
      const existing = context.relevantFiles.find((f) => f.path === file.path);
      if (existing) {
        if (file.score > existing.score) {
          const index = context.relevantFiles.indexOf(existing);
          context.relevantFiles[index] = file;
        }
      } else {
        context.relevantFiles.push(file);
      }
    }
    context.relevantFiles.sort((a, b) => b.score - a.score);
    const MAX_RELEVANT_FILES = 5;
    if (context.relevantFiles.length > MAX_RELEVANT_FILES) {
      context.relevantFiles = context.relevantFiles.slice(0, MAX_RELEVANT_FILES);
    }
  }
  /**
   * Clear relevant files for an agent.
   */
  clearRelevantFiles(agent) {
    const context = this.contexts.get(agent);
    if (context) {
      context.relevantFiles = [];
    }
  }
  /**
   * Reset an agent's context (clear messages, keep system prompt).
   */
  resetContext(agent) {
    const context = this.contexts.get(agent);
    if (context) {
      context.messages = [];
      context.relevantFiles = [];
      context.currentTokens = estimateTokens(context.systemPrompt);
    }
  }
  /**
   * Reset all agent contexts.
   */
  resetAllContexts() {
    for (const agent of this.contexts.keys()) {
      this.resetContext(agent);
    }
  }
  /**
   * Get the messages formatted for LLM API.
   */
  getMessagesForLLM(agent) {
    const context = this.getContext(agent);
    const messages = [
      { role: "system", content: context.systemPrompt }
    ];
    if (context.relevantFiles.length > 0) {
      const fileContext = this.formatRelevantFiles(context.relevantFiles);
      messages.push({
        role: "system",
        content: `Relevant files:
${fileContext}`
      });
    }
    for (const msg of context.messages) {
      messages.push({
        role: msg.role,
        content: msg.content
      });
    }
    return messages;
  }
  /**
   * Format relevant files for inclusion in context.
   */
  formatRelevantFiles(files) {
    return files.map((file) => {
      let content = `## ${file.path}
Reason: ${file.reason}
`;
      if (file.snippets && file.snippets.length > 0) {
        for (const snippet of file.snippets) {
          if (snippet.headingContext) {
            content += `### ${snippet.headingContext}
`;
          }
          content += `Lines ${snippet.startLine}-${snippet.endLine}:
\`\`\`
${snippet.content}
\`\`\`
`;
        }
      }
      return content;
    }).join("\n");
  }
  /**
   * Get available tools for an agent type.
   */
  getAgentTools(agent) {
    switch (agent) {
      case "orchestrator":
        return ["delegate_task", "get_status", "approve_edit"];
      case "editor":
        return ["read_file", "edit_file", "create_file"];
      case "research":
        return ["vector_search", "read_file", "list_directory", "search_files", "search_web"];
      case "critique":
        return ["read_file", "list_directory"];
      case "style":
        return ["read_file"];
      case "creative":
        return ["read_file", "list_directory", "search_files"];
      default:
        return [];
    }
  }
  /**
   * Build the system prompt for an agent.
   * These are compact prompts optimized for small models.
   */
  buildSystemPrompt(agent) {
    switch (agent) {
      case "orchestrator":
        return this.buildOrchestratorPrompt();
      case "editor":
        return this.buildEditorPrompt();
      case "research":
        return this.buildResearchPrompt();
      case "critique":
        return this.buildCritiquePrompt();
      case "style":
        return this.buildStylePrompt();
      case "creative":
        return this.buildCreativePrompt();
      default:
        return "You are a helpful assistant.";
    }
  }
  buildOrchestratorPrompt() {
    return `You are Markus, coordinator for a markdown editor.
ROLE: Route tasks to specialists. DO NOT write content yourself.
SPECIALISTS:
- RESEARCH: Find information from files and web
- EDITOR: Modify files using SEARCH/REPLACE
- CRITIQUE: Review content quality
- STYLE: Check voice and formatting
- CREATIVE: Generate ideas and structure

FORMAT for delegating:
<agent_request agent="name">
task description with specific instructions
</agent_request>

RULES:
1. Decompose complex tasks into subtasks
2. Wait for results before continuing
3. Summarize results for the user
4. Never write markdown content directly`;
  }
  buildEditorPrompt() {
    return `You modify markdown files using SEARCH/REPLACE blocks.

FORMAT:
<edit>
<file>path/to/file.md</file>
<search>
exact text to find with surrounding context
</search>
<replace>
new text to insert
</replace>
</edit>

RULES:
1. Search text must exist in the file
2. Include enough context to make search unique
3. Preserve indentation and formatting
4. One edit per block, multiple blocks allowed
5. For new files, use empty <search></search>`;
  }
  buildResearchPrompt() {
    return `You find information from files and web.

TOOLS:
- vector_search(query): Semantic search across files
- read_file(path): Read file contents
- list_directory(path): List directory contents
- search_files(query, path, pattern): Text search in files
- search_web(query): Web search

FORMAT for results:
<findings>
<source>file path or URL</source>
<summary>key information found</summary>
</findings>

RULES:
1. Search before reading full files
2. Return only relevant snippets
3. Cite sources for all findings`;
  }
  buildCritiquePrompt() {
    return `You review content for quality and consistency.

CHECKLIST:
- Factual accuracy
- Logical flow
- Completeness
- Clarity
- Contradictions

FORMAT:
<review>
<issue severity="high|medium|low">
Description of issue
</issue>
<suggestion>
How to fix it
</suggestion>
</review>

RULES:
1. Be specific about locations
2. Prioritize by severity
3. Suggest concrete fixes`;
  }
  buildStylePrompt() {
    return `You check voice, tone, and formatting.

CHECKLIST:
- Consistent voice
- Appropriate tone
- Heading hierarchy
- List formatting
- Link validity

FORMAT:
<style_issue>
<location>where in document</location>
<issue>what's wrong</issue>
<fix>suggested correction</fix>
</style_issue>

RULES:
1. Match existing document style
2. Flag inconsistencies
3. Preserve author's voice`;
  }
  buildCreativePrompt() {
    return `You generate ideas and document structure.

CAPABILITIES:
- Brainstorm topics
- Outline documents
- Suggest improvements
- Find connections
- Expand on ideas

FORMAT:
<idea>
<title>Brief title</title>
<description>Detailed explanation</description>
<rationale>Why this works</rationale>
</idea>

RULES:
1. Generate multiple options
2. Consider context
3. Be specific, not generic`;
  }
};
var agentContextManager = new AgentContextManager();

// ../../electron/markus/agents/base.ts
var BaseAgent = class {
  /** Current agent status */
  status = "idle";
  /** LLM client for this agent */
  llmClient = null;
  /** Agent settings */
  settings;
  /** Event bus for inter-agent communication */
  eventBus;
  /** Context manager for this agent */
  contextManager;
  /** Current task being processed */
  currentTask = null;
  /** Abort controller for cancellation */
  abortController = null;
  constructor(settings, eventBus = agentEventBus, contextManager = agentContextManager) {
    this.settings = settings;
    this.eventBus = eventBus;
    this.contextManager = contextManager;
  }
  /**
   * Initialize the agent with LLM client.
   */
  initialize() {
    const llmSettings = {
      apiEndpoint: this.settings.endpoint,
      apiKey: this.settings.apiKey || "",
      model: this.settings.model,
      maxTokens: this.settings.maxTokens,
      temperature: this.settings.temperature
    };
    this.llmClient = createLLMClient(llmSettings);
    this.setStatus("idle");
  }
  /**
   * Get the current status.
   */
  getStatus() {
    return this.status;
  }
  /**
   * Set status and emit event.
   */
  setStatus(status, details) {
    this.status = status;
    this.eventBus.emit("agent:status", {
      agent: this.type,
      status,
      details
    });
  }
  /**
   * Process a task assigned to this agent.
   */
  async processTask(task) {
    if (!this.llmClient) {
      throw new Error(`Agent ${this.type} not initialized`);
    }
    this.currentTask = task;
    this.abortController = new AbortController();
    this.setStatus("thinking");
    try {
      task.status = "in_progress";
      this.eventBus.emit("task:updated", { task });
      this.contextManager.addMessage(this.type, {
        role: "user",
        content: this.formatTaskPrompt(task)
      });
      const messages = this.contextManager.getMessagesForLLM(this.type);
      const tools = this.getToolDefinitions();
      const response = await this.llmClient.chat(
        messages,
        tools,
        this.abortController.signal
      );
      const result = await this.processResponse(response, task);
      task.status = "complete";
      task.result = result;
      task.completedAt = Date.now();
      this.eventBus.emit("task:completed", { task });
      this.contextManager.addMessage(this.type, {
        role: "assistant",
        content: response.content
      });
    } catch (error) {
      if (error.name === "AbortError") {
        task.status = "cancelled";
      } else {
        task.status = "failed";
        task.error = String(error);
        this.eventBus.emit("error", {
          agent: this.type,
          error: String(error),
          taskId: task.id
        });
      }
      this.eventBus.emit("task:updated", { task });
    } finally {
      this.currentTask = null;
      this.abortController = null;
      this.setStatus("idle");
    }
  }
  /**
   * Cancel the current task.
   */
  cancel() {
    if (this.abortController) {
      this.abortController.abort();
    }
  }
  /**
   * Send a message to another agent.
   */
  sendMessage(to, content, type = "response", data) {
    const message = {
      id: v4_default(),
      from: this.type,
      to,
      content,
      data,
      timestamp: Date.now(),
      type
    };
    this.eventBus.emit("message:sent", { message });
    return message;
  }
  /**
   * Format a task into a prompt for the LLM.
   */
  formatTaskPrompt(task) {
    let prompt = `Task: ${task.description}
`;
    if (Object.keys(task.context).length > 0) {
      prompt += "\nContext:\n";
      for (const [key, value] of Object.entries(task.context)) {
        prompt += `- ${key}: ${JSON.stringify(value)}
`;
      }
    }
    return prompt;
  }
  /**
   * Process LLM response and execute any tool calls.
   */
  async processResponse(response) {
    if (response.toolCalls.length > 0) {
      this.setStatus("executing");
      const results = [];
      for (const toolCall of response.toolCalls) {
        const result = await this.executeTool(toolCall.name, toolCall.arguments);
        results.push({
          tool: toolCall.name,
          result: result.success ? result.result : result.error,
          success: result.success
        });
      }
      return {
        content: response.content,
        toolResults: results
      };
    }
    return {
      content: response.content
    };
  }
  /**
   * Reset the agent's context.
   */
  reset() {
    this.contextManager.resetContext(this.type);
    this.setStatus("idle");
  }
};
var DEFAULT_AGENT_SETTINGS = {
  orchestrator: {
    maxTokens: 8192,
    temperature: 0.7
  },
  editor: {
    maxTokens: 4096,
    temperature: 0.3
    // Lower for more deterministic edits
  },
  research: {
    maxTokens: 6144,
    temperature: 0.5
  },
  critique: {
    maxTokens: 6144,
    temperature: 0.5
  },
  style: {
    maxTokens: 4096,
    temperature: 0.5
  },
  creative: {
    maxTokens: 6144,
    temperature: 0.8
    // Higher for more creative output
  }
};
function mergeAgentSettings(type, settings, defaults) {
  const typeDefaults = DEFAULT_AGENT_SETTINGS[type];
  return {
    model: settings.model || defaults.model || "gpt-4o-mini",
    endpoint: settings.endpoint || defaults.endpoint || "http://localhost:11434/v1",
    apiKey: settings.apiKey || defaults.apiKey,
    maxTokens: settings.maxTokens || defaults.maxTokens || typeDefaults.maxTokens || 4096,
    temperature: settings.temperature ?? defaults.temperature ?? typeDefaults.temperature ?? 0.7,
    timeout: settings.timeout || defaults.timeout || 6e4
  };
}

// ../../electron/markus/agents/router.ts
var AgentRegistry = class {
  agents = /* @__PURE__ */ new Map();
  /**
   * Register an agent instance.
   */
  register(agent) {
    this.agents.set(agent.type, agent);
  }
  /**
   * Get an agent by type.
   */
  get(type) {
    return this.agents.get(type);
  }
  /**
   * Get all registered agents.
   */
  getAll() {
    return Array.from(this.agents.values());
  }
  /**
   * Check if an agent is registered.
   */
  has(type) {
    return this.agents.has(type);
  }
  /**
   * Remove an agent.
   */
  remove(type) {
    this.agents.delete(type);
  }
  /**
   * Clear all agents.
   */
  clear() {
    this.agents.clear();
  }
};
var TaskQueue = class {
  tasks = [];
  taskMap = /* @__PURE__ */ new Map();
  /**
   * Add a task to the queue.
   */
  enqueue(task) {
    this.tasks.push(task);
    this.taskMap.set(task.id, task);
    this.tasks.sort((a, b) => a.priority - b.priority);
  }
  /**
   * Get the next task for an agent type.
   */
  dequeue(agentType) {
    const index = agentType ? this.tasks.findIndex((t) => t.agent === agentType && t.status === "pending") : this.tasks.findIndex((t) => t.status === "pending");
    if (index >= 0) {
      const task = this.tasks[index];
      return task;
    }
    return void 0;
  }
  /**
   * Get a task by ID.
   */
  get(taskId) {
    return this.taskMap.get(taskId);
  }
  /**
   * Update a task.
   */
  update(taskId, updates) {
    const task = this.taskMap.get(taskId);
    if (task) {
      Object.assign(task, updates);
    }
  }
  /**
   * Remove completed/failed tasks.
   */
  cleanup() {
    const completedStatuses = ["complete", "failed", "cancelled"];
    this.tasks = this.tasks.filter((t) => !completedStatuses.includes(t.status));
    for (const [id, task] of this.taskMap.entries()) {
      if (completedStatuses.includes(task.status)) {
        this.taskMap.delete(id);
      }
    }
  }
  /**
   * Get all tasks.
   */
  getAll() {
    return [...this.tasks];
  }
  /**
   * Get pending tasks count.
   */
  getPendingCount() {
    return this.tasks.filter((t) => t.status === "pending").length;
  }
};
var AgentRouter = class {
  registry = new AgentRegistry();
  taskQueue = new TaskQueue();
  eventBus;
  contextManager;
  settings;
  processing = false;
  constructor(settings, eventBus = agentEventBus, contextManager = agentContextManager) {
    this.settings = settings;
    this.eventBus = eventBus;
    this.contextManager = contextManager;
    this.eventBus.on("task:completed", () => {
      this.onTaskCompleted();
    });
    this.eventBus.on("task:updated", ({ task }) => {
      this.taskQueue.update(task.id, task);
    });
  }
  /**
   * Register an agent with the router.
   */
  registerAgent(agent) {
    this.registry.register(agent);
    agent.initialize();
  }
  /**
   * Get settings for an agent type.
   */
  getAgentSettings(type) {
    const agentSpecific = this.settings[type] || {};
    const defaults = this.settings.defaults || {};
    return mergeAgentSettings(type, agentSpecific, defaults);
  }
  /**
   * Create and queue a task.
   */
  createTask(agent, description, context = {}, priority = 5, parentId) {
    const task = {
      id: v4_default(),
      description,
      agent,
      priority,
      status: "pending",
      parentId,
      context,
      createdAt: Date.now()
    };
    this.taskQueue.enqueue(task);
    this.eventBus.emit("task:created", { task });
    this.processQueue();
    return task;
  }
  /**
   * Route a user message to the appropriate agent.
   * By default, routes to the orchestrator, but can route to a specific
   * agent if targetAgent is specified in context.
   */
  async routeUserMessage(message, context = {}) {
    const targetAgent = context.targetAgent;
    const agent = targetAgent && this.registry.get(targetAgent) ? targetAgent : "orchestrator";
    return this.createTask(
      agent,
      message,
      context,
      1
      // High priority for user messages
    );
  }
  /**
   * Process the task queue.
   */
  async processQueue() {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.taskQueue.getPendingCount() > 0) {
        const tasksByAgent = this.groupTasksByAgent();
        const promises = [];
        for (const [agentType, tasks] of tasksByAgent.entries()) {
          const agent = this.registry.get(agentType);
          if (agent && agent.getStatus() === "idle" && tasks.length > 0) {
            const task = tasks[0];
            promises.push(agent.processTask(task));
          }
        }
        if (promises.length === 0) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        } else {
          await Promise.race(promises);
        }
      }
    } finally {
      this.processing = false;
    }
  }
  /**
   * Group pending tasks by agent type.
   */
  groupTasksByAgent() {
    const grouped = /* @__PURE__ */ new Map();
    const allTasks = this.taskQueue.getAll();
    for (const task of allTasks) {
      if (task.status !== "pending") continue;
      const existing = grouped.get(task.agent) || [];
      existing.push(task);
      grouped.set(task.agent, existing);
    }
    return grouped;
  }
  /**
   * Handle task completion.
   */
  onTaskCompleted() {
    if (this.taskQueue.getAll().filter((t) => t.status === "complete").length > 100) {
      this.taskQueue.cleanup();
    }
    this.processQueue();
  }
  /**
   * Cancel a task.
   */
  cancelTask(taskId) {
    const task = this.taskQueue.get(taskId);
    if (!task) return;
    if (task.status === "pending") {
      task.status = "cancelled";
      this.eventBus.emit("task:updated", { task });
    } else if (task.status === "in_progress") {
      const agent = this.registry.get(task.agent);
      if (agent) {
        agent.cancel();
      }
    }
  }
  /**
   * Cancel all tasks.
   */
  cancelAll() {
    for (const task of this.taskQueue.getAll()) {
      this.cancelTask(task.id);
    }
  }
  /**
   * Get task status.
   */
  getTaskStatus(taskId) {
    return this.taskQueue.get(taskId);
  }
  /**
   * Get all agent statuses.
   */
  getAgentStatuses() {
    return this.registry.getAll().map((agent) => ({
      type: agent.type,
      status: agent.getStatus()
    }));
  }
  /**
   * Reset all agents.
   */
  reset() {
    this.cancelAll();
    for (const agent of this.registry.getAll()) {
      agent.reset();
    }
    this.taskQueue.cleanup();
  }
  /**
   * Shutdown the router.
   */
  shutdown() {
    this.cancelAll();
    this.registry.clear();
  }
};
var routerInstance = null;
function getAgentRouter(settings) {
  if (!routerInstance && settings) {
    routerInstance = new AgentRouter(settings);
  }
  if (!routerInstance) {
    throw new Error("AgentRouter not initialized. Call with settings first.");
  }
  return routerInstance;
}
function resetAgentRouter() {
  if (routerInstance) {
    routerInstance.shutdown();
    routerInstance = null;
  }
}

// ../../electron/markus/agents/orchestrator.ts
function parseAgentRequests(content) {
  const requests = [];
  const regex = /<agent_request\s+agent="([^"]+)">([\s\S]*?)<\/agent_request>/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const agent = match[1];
    const task = match[2].trim();
    const validAgents = ["editor", "research", "critique", "style", "creative"];
    if (validAgents.includes(agent)) {
      requests.push({ agent, task });
    }
  }
  return requests;
}
var OrchestratorAgent = class extends BaseAgent {
  type = "orchestrator";
  /** Router for delegating to other agents */
  router = null;
  /** Workspace folders */
  workspaceFolders = [];
  constructor(settings, workspaceFolders = []) {
    super(settings, agentEventBus, agentContextManager);
    this.workspaceFolders = workspaceFolders;
  }
  /**
   * Set the agent router.
   */
  setRouter(router) {
    this.router = router;
  }
  /**
   * Update workspace folders.
   */
  setWorkspaceFolders(folders) {
    this.workspaceFolders = folders;
  }
  /**
   * Get tool definitions for the orchestrator.
   */
  getToolDefinitions() {
    return [
      {
        name: "delegate_task",
        description: "Delegate a task to a specialist agent",
        parameters: {
          type: "object",
          properties: {
            agent: {
              type: "string",
              description: "Agent to delegate to: research, editor, critique, style, creative",
              enum: ["research", "editor", "critique", "style", "creative"]
            },
            task: {
              type: "string",
              description: "Task description for the agent"
            },
            context: {
              type: "string",
              description: "Additional context for the task"
            }
          },
          required: ["agent", "task"]
        }
      },
      {
        name: "get_status",
        description: "Get status of all agents and pending tasks",
        parameters: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "approve_edit",
        description: "Approve or reject a proposed edit from the editor agent",
        parameters: {
          type: "object",
          properties: {
            editId: {
              type: "string",
              description: "Edit ID to approve or reject"
            },
            approved: {
              type: "boolean",
              description: "Whether to approve the edit"
            }
          },
          required: ["editId", "approved"]
        }
      }
    ];
  }
  /**
   * Execute a tool call.
   */
  async executeTool(toolName, args) {
    switch (toolName) {
      case "delegate_task":
        return this.executeDelegateTask(args);
      case "get_status":
        return this.executeGetStatus();
      case "approve_edit":
        return this.executeApproveEdit(args);
      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  }
  /**
   * Delegate a task to another agent.
   */
  async executeDelegateTask(args) {
    const agent = String(args.agent || "");
    const task = String(args.task || "");
    const context = args.context ? String(args.context) : "";
    if (!agent || !task) {
      return { success: false, error: "Agent and task are required" };
    }
    if (!this.router) {
      return { success: false, error: "Router not initialized" };
    }
    const agentTask = this.router.createTask(
      agent,
      task,
      {
        workspaceFolders: this.workspaceFolders,
        additionalContext: context,
        parentTaskId: this.currentTask?.id
      },
      3
      // Medium priority for delegated tasks
    );
    return {
      success: true,
      result: {
        taskId: agentTask.id,
        agent,
        status: agentTask.status
      }
    };
  }
  /**
   * Get status of all agents.
   */
  executeGetStatus() {
    if (!this.router) {
      return { success: false, error: "Router not initialized" };
    }
    const statuses = this.router.getAgentStatuses();
    return {
      success: true,
      result: statuses
    };
  }
  /**
   * Approve or reject an edit.
   */
  async executeApproveEdit(args) {
    const editId = String(args.editId || "");
    const approved = Boolean(args.approved);
    if (!editId) {
      return { success: false, error: "Edit ID is required" };
    }
    this.eventBus.emit("message:sent", {
      message: {
        id: v4_default(),
        from: "orchestrator",
        to: "editor",
        content: approved ? "Edit approved" : "Edit rejected",
        data: { editId, approved },
        timestamp: Date.now(),
        type: "approval"
      }
    });
    return {
      success: true,
      result: { editId, approved }
    };
  }
  /**
   * Process LLM response and handle agent requests.
   */
  async processResponse(response, task) {
    const baseResult = await super.processResponse(response, task);
    const agentRequests = parseAgentRequests(response.content);
    if (agentRequests.length > 0 && this.router) {
      const delegatedTasks = [];
      for (const request of agentRequests) {
        const agentTask = this.router.createTask(
          request.agent,
          request.task,
          {
            workspaceFolders: this.workspaceFolders,
            parentTaskId: task.id
          },
          3
        );
        delegatedTasks.push({
          agent: request.agent,
          taskId: agentTask.id
        });
      }
      return {
        ...baseResult,
        delegatedTasks
      };
    }
    return baseResult;
  }
};
function createOrchestratorAgent(settings, workspaceFolders = []) {
  const agent = new OrchestratorAgent(settings, workspaceFolders);
  agent.initialize();
  return agent;
}

// ../../electron/markus/agents/research.ts
import fs3 from "fs/promises";

// ../../electron/markus/rag/indexManager.ts
import fs2 from "fs/promises";
import path3 from "path";
import crypto2 from "crypto";

// ../../electron/markus/rag/chunker.ts
function estimateTokens2(text) {
  return Math.ceil(text.length / 4);
}
function parseMarkdownSections(content) {
  const lines = content.split("\n");
  const root = {
    level: 0,
    title: "",
    content: "",
    startLine: 1,
    endLine: lines.length,
    children: []
  };
  const stack = [root];
  let currentContentLines = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const currentSection = stack[stack.length - 1];
      if (currentContentLines.length > 0) {
        currentSection.content += currentContentLines.join("\n");
        currentContentLines = [];
      }
      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();
      const newSection = {
        level,
        title,
        content: "",
        startLine: lineNumber,
        endLine: lineNumber,
        children: []
      };
      while (stack.length > 1 && stack[stack.length - 1].level >= level) {
        const popped = stack.pop();
        popped.endLine = lineNumber - 1;
      }
      stack[stack.length - 1].children.push(newSection);
      stack.push(newSection);
    } else {
      currentContentLines.push(line);
    }
  }
  if (currentContentLines.length > 0) {
    const currentSection = stack[stack.length - 1];
    currentSection.content += currentContentLines.join("\n");
  }
  while (stack.length > 1) {
    const popped = stack.pop();
    popped.endLine = lines.length;
  }
  root.endLine = lines.length;
  return root;
}
function getHeadingContext(section, parent = []) {
  if (section.level === 0) {
    return parent;
  }
  return [...parent, section.title];
}
function splitWithOverlap(text, maxTokens, overlapTokens, startLine) {
  const chunks = [];
  const lines = text.split("\n");
  if (lines.length === 0 || !text.trim()) {
    return chunks;
  }
  let currentChunk = [];
  let currentTokens = 0;
  let chunkStartLine = startLine;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineTokens = estimateTokens2(line);
    if (currentTokens + lineTokens > maxTokens && currentChunk.length > 0) {
      chunks.push({
        content: currentChunk.join("\n"),
        startLine: chunkStartLine,
        endLine: startLine + i - 1
      });
      const overlapLines = [];
      let overlapTokenCount = 0;
      for (let j = currentChunk.length - 1; j >= 0 && overlapTokenCount < overlapTokens; j--) {
        overlapLines.unshift(currentChunk[j]);
        overlapTokenCount += estimateTokens2(currentChunk[j]);
      }
      currentChunk = overlapLines;
      currentTokens = overlapTokenCount;
      chunkStartLine = startLine + i - overlapLines.length;
    }
    currentChunk.push(line);
    currentTokens += lineTokens;
  }
  if (currentChunk.length > 0) {
    chunks.push({
      content: currentChunk.join("\n"),
      startLine: chunkStartLine,
      endLine: startLine + lines.length - 1
    });
  }
  return chunks;
}
function chunkSection(section, filePath, options, headingContext, chunks) {
  const context = getHeadingContext(section, headingContext);
  if (section.content.trim()) {
    const sectionChunks = splitWithOverlap(
      section.content.trim(),
      options.maxChunkSize,
      options.overlap,
      section.startLine
    );
    for (const chunk of sectionChunks) {
      const tokens = estimateTokens2(chunk.content);
      if (tokens >= options.minChunkSize) {
        chunks.push({
          id: `${filePath}:${chunk.startLine}-${chunk.endLine}`,
          filePath,
          content: chunk.content,
          tokens,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          headingContext: context,
          sectionTitle: section.title || void 0,
          chunkIndex: chunks.length
        });
      }
    }
  }
  for (const child of section.children) {
    chunkSection(child, filePath, options, context, chunks);
  }
}
function chunkMarkdown(content, filePath, options = {}) {
  const opts = {
    maxChunkSize: options.maxChunkSize ?? 512,
    overlap: options.overlap ?? 50,
    minChunkSize: options.minChunkSize ?? 50
  };
  const root = parseMarkdownSections(content);
  const chunks = [];
  chunkSection(root, filePath, opts, [], chunks);
  for (let i = 0; i < chunks.length; i++) {
    chunks[i].chunkIndex = i;
    chunks[i].id = `${filePath}:chunk-${i}`;
  }
  return chunks;
}
function chunkPlainText(content, filePath, options = {}) {
  const opts = {
    maxChunkSize: options.maxChunkSize ?? 512,
    overlap: options.overlap ?? 50,
    minChunkSize: options.minChunkSize ?? 50
  };
  const rawChunks = splitWithOverlap(content, opts.maxChunkSize, opts.overlap, 1);
  const chunks = [];
  for (let i = 0; i < rawChunks.length; i++) {
    const chunk = rawChunks[i];
    const tokens = estimateTokens2(chunk.content);
    if (tokens >= opts.minChunkSize) {
      chunks.push({
        id: `${filePath}:chunk-${i}`,
        filePath,
        content: chunk.content,
        tokens,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        headingContext: [],
        chunkIndex: i
      });
    }
  }
  return chunks;
}
function chunkDocument(content, filePath, options = {}) {
  const ext = filePath.toLowerCase().split(".").pop() || "";
  if (["md", "markdown", "mdx"].includes(ext)) {
    return chunkMarkdown(content, filePath, options);
  }
  return chunkPlainText(content, filePath, options);
}

// ../../electron/markus/rag/embeddings.ts
var BaseEmbeddingProvider = class {
  /**
   * Calculate cosine similarity between two vectors.
   */
  cosineSimilarity(a, b) {
    if (a.length !== b.length) {
      throw new Error("Vectors must have the same dimension");
    }
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    if (magnitude === 0) return 0;
    return dotProduct / magnitude;
  }
};
var TFIDFEmbeddingProvider = class extends BaseEmbeddingProvider {
  provider = "tfidf";
  dimension;
  /** Vocabulary map */
  vocabulary = /* @__PURE__ */ new Map();
  /** Document frequency for each term */
  documentFrequency = /* @__PURE__ */ new Map();
  /** Total documents seen */
  totalDocuments = 0;
  constructor(dimension = 384) {
    super();
    this.dimension = dimension;
  }
  /**
   * Tokenize text into terms.
   */
  tokenize(text) {
    return text.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter((t) => t.length > 2);
  }
  /**
   * Add document to the index for IDF calculation.
   */
  addDocument(text) {
    const terms = new Set(this.tokenize(text));
    this.totalDocuments++;
    for (const term of terms) {
      if (!this.vocabulary.has(term)) {
        this.vocabulary.set(term, this.vocabulary.size);
      }
      this.documentFrequency.set(
        term,
        (this.documentFrequency.get(term) || 0) + 1
      );
    }
  }
  /**
   * Generate TF-IDF embedding.
   */
  async embed(text) {
    const start = Date.now();
    const terms = this.tokenize(text);
    const tf = /* @__PURE__ */ new Map();
    for (const term of terms) {
      tf.set(term, (tf.get(term) || 0) + 1);
    }
    const vector = new Array(this.dimension).fill(0);
    const maxTf = Math.max(...tf.values(), 1);
    for (const [term, freq] of tf.entries()) {
      const vocabIndex = this.vocabulary.get(term);
      if (vocabIndex === void 0) continue;
      const normalizedTf = freq / maxTf;
      const df = this.documentFrequency.get(term) || 1;
      const idf = Math.log((this.totalDocuments + 1) / (df + 1)) + 1;
      const tfidf = normalizedTf * idf;
      const hashIndex = vocabIndex % this.dimension;
      vector[hashIndex] += tfidf;
    }
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] /= norm;
      }
    }
    return {
      vector,
      tokens: terms.length,
      processingTime: Date.now() - start
    };
  }
  /**
   * Batch embedding.
   */
  async embedBatch(texts) {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
};
var APIEmbeddingProvider = class extends BaseEmbeddingProvider {
  provider = "api";
  dimension;
  endpoint;
  apiKey;
  model;
  constructor(config) {
    super();
    this.endpoint = config.endpoint || "http://localhost:11434/v1/embeddings";
    this.apiKey = config.apiKey || "";
    this.model = config.model || "text-embedding-3-small";
    this.dimension = config.dimension || 1536;
  }
  /**
   * Generate embedding via API.
   */
  async embed(text) {
    const results = await this.embedBatch([text]);
    return results[0];
  }
  /**
   * Batch embedding via API.
   */
  async embedBatch(texts) {
    const start = Date.now();
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        input: texts
      })
    });
    if (!response.ok) {
      throw new Error(`Embedding API error: ${response.status}`);
    }
    const data = await response.json();
    const processingTime = Date.now() - start;
    return data.data.map((d) => ({
      vector: d.embedding,
      tokens: Math.ceil(texts[d.index].length / 4),
      processingTime
    }));
  }
};
var LocalEmbeddingProvider = class extends BaseEmbeddingProvider {
  provider = "local";
  dimension = 384;
  fallback;
  initialized = false;
  constructor() {
    super();
    this.fallback = new TFIDFEmbeddingProvider(384);
    console.log("[Embeddings] Local ONNX provider using TF-IDF fallback until onnxruntime-node is installed");
  }
  /**
   * Initialize the ONNX runtime.
   * This is a placeholder - actual implementation would load the model.
   */
  async initialize() {
    this.initialized = true;
  }
  /**
   * Add document to fallback index.
   */
  addDocument(text) {
    this.fallback.addDocument(text);
  }
  async embed(text) {
    if (!this.initialized) {
      await this.initialize();
    }
    return this.fallback.embed(text);
  }
  async embedBatch(texts) {
    if (!this.initialized) {
      await this.initialize();
    }
    return this.fallback.embedBatch(texts);
  }
};
function createEmbeddingProvider(config) {
  switch (config.provider) {
    case "api":
      return new APIEmbeddingProvider(config);
    case "tfidf":
      return new TFIDFEmbeddingProvider(config.dimension);
    case "local":
    default:
      return new LocalEmbeddingProvider();
  }
}

// ../../electron/markus/rag/vectorStore.ts
import fs from "fs/promises";
import { existsSync as existsSync2 } from "fs";
import path2 from "path";
import crypto from "crypto";
var VectorStore = class {
  /** Documents by ID */
  documents = /* @__PURE__ */ new Map();
  /** File index for change detection */
  fileIndex = /* @__PURE__ */ new Map();
  /** Embedding provider */
  embedder;
  /** Store directory for persistence */
  storeDir = null;
  /** Whether the store has been modified since last save */
  isDirty = false;
  constructor(embedder, storeDir) {
    this.embedder = embedder;
    this.storeDir = storeDir || null;
  }
  /**
   * Calculate hash of file content.
   */
  hashContent(content) {
    return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
  }
  /**
   * Check if a file needs reindexing.
   */
  needsReindex(filePath, contentHash) {
    const entry = this.fileIndex.get(filePath);
    if (!entry) return true;
    return entry.hash !== contentHash;
  }
  /**
   * Remove all chunks for a file.
   */
  removeFile(filePath) {
    const entry = this.fileIndex.get(filePath);
    if (entry) {
      for (const chunkId of entry.chunkIds) {
        this.documents.delete(chunkId);
      }
      this.fileIndex.delete(filePath);
      this.isDirty = true;
    }
  }
  /**
   * Index chunks from a file.
   */
  async indexChunks(chunks, fileContent) {
    if (chunks.length === 0) return;
    const filePath = chunks[0].filePath;
    const fileHash = this.hashContent(fileContent);
    if (!this.needsReindex(filePath, fileHash)) {
      return;
    }
    this.removeFile(filePath);
    const texts = chunks.map((c) => c.content);
    const embeddings = await this.embedder.embedBatch(texts);
    const chunkIds = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = embeddings[i];
      const doc = {
        id: chunk.id,
        filePath: chunk.filePath,
        content: chunk.content,
        embedding: embedding.vector,
        metadata: {
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          headingContext: chunk.headingContext,
          sectionTitle: chunk.sectionTitle,
          chunkIndex: chunk.chunkIndex,
          tokens: chunk.tokens
        },
        fileHash,
        indexedAt: Date.now()
      };
      this.documents.set(chunk.id, doc);
      chunkIds.push(chunk.id);
    }
    this.fileIndex.set(filePath, {
      path: filePath,
      hash: fileHash,
      modifiedAt: Date.now(),
      chunkIds
    });
    this.isDirty = true;
  }
  /**
   * Search for similar documents.
   */
  async search(query, limit = 10, minScore = 0.3) {
    if (this.documents.size === 0) {
      return [];
    }
    const queryEmbedding = await this.embedder.embed(query);
    const results = [];
    for (const doc of this.documents.values()) {
      const score = this.embedder.cosineSimilarity(
        queryEmbedding.vector,
        doc.embedding
      );
      if (score >= minScore) {
        results.push({
          document: doc,
          score,
          rank: 0
        });
      }
    }
    results.sort((a, b) => b.score - a.score);
    const limited = results.slice(0, limit);
    for (let i = 0; i < limited.length; i++) {
      limited[i].rank = i + 1;
    }
    return limited;
  }
  /**
   * Search within specific files.
   */
  async searchInFiles(query, filePaths, limit = 10, minScore = 0.3) {
    if (this.documents.size === 0) {
      return [];
    }
    const queryEmbedding = await this.embedder.embed(query);
    const fileSet = new Set(filePaths);
    const results = [];
    for (const doc of this.documents.values()) {
      if (!fileSet.has(doc.filePath)) continue;
      const score = this.embedder.cosineSimilarity(
        queryEmbedding.vector,
        doc.embedding
      );
      if (score >= minScore) {
        results.push({
          document: doc,
          score,
          rank: 0
        });
      }
    }
    results.sort((a, b) => b.score - a.score);
    const limited = results.slice(0, limit);
    for (let i = 0; i < limited.length; i++) {
      limited[i].rank = i + 1;
    }
    return limited;
  }
  /**
   * Get all indexed file paths.
   */
  getIndexedFiles() {
    return Array.from(this.fileIndex.keys());
  }
  /**
   * Get total document count.
   */
  getDocumentCount() {
    return this.documents.size;
  }
  /**
   * Get file count.
   */
  getFileCount() {
    return this.fileIndex.size;
  }
  /**
   * Clear all data.
   */
  clear() {
    this.documents.clear();
    this.fileIndex.clear();
    this.isDirty = true;
  }
  /**
   * Save to disk.
   */
  async save() {
    if (!this.storeDir || !this.isDirty) return;
    await fs.mkdir(this.storeDir, { recursive: true });
    const docsPath = path2.join(this.storeDir, "documents.json");
    const docsData = Array.from(this.documents.values());
    await fs.writeFile(docsPath, JSON.stringify(docsData), "utf-8");
    const indexPath = path2.join(this.storeDir, "file_index.json");
    const indexData = Array.from(this.fileIndex.values());
    await fs.writeFile(indexPath, JSON.stringify(indexData), "utf-8");
    this.isDirty = false;
  }
  /**
   * Load from disk.
   */
  async load() {
    if (!this.storeDir) return false;
    const docsPath = path2.join(this.storeDir, "documents.json");
    const indexPath = path2.join(this.storeDir, "file_index.json");
    if (!existsSync2(docsPath) || !existsSync2(indexPath)) {
      return false;
    }
    try {
      const docsData = JSON.parse(await fs.readFile(docsPath, "utf-8"));
      for (const doc of docsData) {
        this.documents.set(doc.id, doc);
      }
      const indexData = JSON.parse(await fs.readFile(indexPath, "utf-8"));
      for (const entry of indexData) {
        this.fileIndex.set(entry.path, entry);
      }
      this.isDirty = false;
      return true;
    } catch (error) {
      console.error("[VectorStore] Failed to load:", error);
      return false;
    }
  }
};

// ../../electron/markus/rag/indexManager.ts
var IndexManager = class {
  vectorStore = null;
  embedder = null;
  workspaceFolders = [];
  settings;
  status = {
    indexing: false,
    totalFiles: 0,
    indexedFiles: 0,
    totalChunks: 0,
    lastUpdated: null
  };
  storeDir;
  /** Event listeners */
  listeners = /* @__PURE__ */ new Map();
  constructor(settings, configDir) {
    this.settings = settings;
    this.storeDir = path3.join(configDir, "rag");
  }
  /**
   * Initialize the index manager.
   */
  async initialize(workspaceFolders) {
    this.workspaceFolders = workspaceFolders;
    if (!this.settings.enabled) {
      console.log("[IndexManager] RAG is disabled");
      return;
    }
    const embeddingConfig = {
      provider: this.settings.embeddings.provider,
      model: this.settings.embeddings.model
    };
    this.embedder = createEmbeddingProvider(embeddingConfig);
    const workspaceHash = this.hashWorkspace(workspaceFolders);
    const storePath = path3.join(this.storeDir, workspaceHash);
    this.vectorStore = new VectorStore(this.embedder, storePath);
    const loaded = await this.vectorStore.load();
    if (loaded) {
      console.log(
        `[IndexManager] Loaded existing index with ${this.vectorStore.getDocumentCount()} chunks`
      );
      this.status.totalChunks = this.vectorStore.getDocumentCount();
      this.status.lastUpdated = Date.now();
    }
  }
  /**
   * Hash workspace folders for unique storage path.
   */
  hashWorkspace(folders) {
    const sorted = [...folders].sort().join("|");
    return crypto2.createHash("sha256").update(sorted).digest("hex").slice(0, 16);
  }
  /**
   * Get index status.
   */
  getStatus() {
    return { ...this.status };
  }
  /**
   * Emit an event.
   */
  emit(event, data) {
    const handlers = this.listeners.get(event) || [];
    for (const handler of handlers) {
      handler(data);
    }
  }
  /**
   * Subscribe to an event.
   */
  on(event, handler) {
    const handlers = this.listeners.get(event) || [];
    handlers.push(handler);
    this.listeners.set(event, handlers);
    return () => {
      const current = this.listeners.get(event) || [];
      const index = current.indexOf(handler);
      if (index >= 0) {
        current.splice(index, 1);
      }
    };
  }
  /**
   * Index all markdown files in workspace.
   */
  async indexWorkspace() {
    if (!this.settings.enabled || !this.vectorStore || !this.embedder) {
      return;
    }
    if (this.status.indexing) {
      console.log("[IndexManager] Indexing already in progress");
      return;
    }
    const startTime = Date.now();
    this.status.indexing = true;
    this.status.indexedFiles = 0;
    try {
      const files = [];
      for (const folder of this.workspaceFolders) {
        await this.collectFiles(folder, files);
      }
      this.status.totalFiles = files.length;
      this.emit("index:start", { totalFiles: files.length });
      if (this.embedder instanceof LocalEmbeddingProvider) {
        for (const file of files) {
          const content = await fs2.readFile(file, "utf-8");
          this.embedder.addDocument(content);
        }
      }
      for (const file of files) {
        try {
          await this.indexFile(file);
          this.status.indexedFiles++;
          this.emit("index:progress", {
            file,
            progress: this.status.indexedFiles / this.status.totalFiles
          });
        } catch (error) {
          console.error(`[IndexManager] Error indexing ${file}:`, error);
        }
      }
      await this.vectorStore.save();
      this.status.totalChunks = this.vectorStore.getDocumentCount();
      this.status.lastUpdated = Date.now();
      const duration = Date.now() - startTime;
      this.emit("index:complete", {
        totalChunks: this.status.totalChunks,
        duration
      });
      console.log(
        `[IndexManager] Indexed ${this.status.totalChunks} chunks from ${files.length} files in ${duration}ms`
      );
    } catch (error) {
      this.status.error = String(error);
      this.emit("index:error", { error: String(error) });
    } finally {
      this.status.indexing = false;
    }
  }
  /**
   * Collect files to index from a directory.
   */
  async collectFiles(dir, files, depth = 0) {
    if (depth > 10) return;
    const entries = await fs2.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist" || entry.name === "build") {
        continue;
      }
      const fullPath = path3.join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.collectFiles(fullPath, files, depth + 1);
      } else if (entry.isFile()) {
        const ext = entry.name.toLowerCase().split(".").pop();
        if (["md", "markdown", "mdx", "txt"].includes(ext || "")) {
          files.push(fullPath);
        }
      }
    }
  }
  /**
   * Index a single file.
   */
  async indexFile(filePath) {
    if (!this.vectorStore) return;
    const content = await fs2.readFile(filePath, "utf-8");
    const chunks = chunkDocument(content, filePath, {
      maxChunkSize: this.settings.chunking.maxChunkSize,
      overlap: this.settings.chunking.overlap
    });
    await this.vectorStore.indexChunks(chunks, content);
  }
  /**
   * Remove a file from the index.
   */
  removeFile(filePath) {
    if (!this.vectorStore) return;
    this.vectorStore.removeFile(filePath);
  }
  /**
   * Search the index.
   */
  async search(query, limit = 10, minScore = 0.3) {
    if (!this.vectorStore || !this.settings.enabled) {
      return [];
    }
    return this.vectorStore.search(query, limit, minScore);
  }
  /**
   * Search within specific files.
   */
  async searchInFiles(query, filePaths, limit = 10) {
    if (!this.vectorStore || !this.settings.enabled) {
      return [];
    }
    return this.vectorStore.searchInFiles(query, filePaths, limit);
  }
  /**
   * Clear the entire index.
   */
  async clear() {
    if (!this.vectorStore) return;
    this.vectorStore.clear();
    await this.vectorStore.save();
    this.status.totalChunks = 0;
  }
  /**
   * Save the index.
   */
  async save() {
    if (!this.vectorStore) return;
    await this.vectorStore.save();
  }
};
var indexManagerInstance = null;
function getIndexManager(settings, configDir) {
  if (!indexManagerInstance && settings && configDir) {
    indexManagerInstance = new IndexManager(settings, configDir);
  }
  if (!indexManagerInstance) {
    throw new Error("IndexManager not initialized");
  }
  return indexManagerInstance;
}
function resetIndexManager() {
  if (indexManagerInstance) {
    indexManagerInstance = null;
  }
}

// ../../electron/markus/agents/research.ts
var ResearchAgent = class extends BaseAgent {
  type = "research";
  /** Workspace folders for path validation */
  workspaceFolders = [];
  constructor(settings, workspaceFolders = []) {
    super(settings, agentEventBus, agentContextManager);
    this.workspaceFolders = workspaceFolders;
  }
  /**
   * Update workspace folders.
   */
  setWorkspaceFolders(folders) {
    this.workspaceFolders = folders;
  }
  /**
   * Get tool definitions for the research agent.
   */
  getToolDefinitions() {
    return [
      {
        name: "vector_search",
        description: "Semantic search across all indexed files. Returns relevant chunks.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query"
            },
            limit: {
              type: "number",
              description: "Maximum results (default: 5)"
            }
          },
          required: ["query"]
        }
      },
      {
        name: "read_file",
        description: "Read the contents of a file.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the file"
            },
            startLine: {
              type: "number",
              description: "Start line (1-indexed, optional)"
            },
            endLine: {
              type: "number",
              description: "End line (optional)"
            }
          },
          required: ["path"]
        }
      },
      {
        name: "list_directory",
        description: "List files and directories in a path.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Directory path"
            },
            recursive: {
              type: "boolean",
              description: "List recursively (default: false)"
            }
          },
          required: ["path"]
        }
      },
      {
        name: "search_files",
        description: "Text search for patterns in files.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Text to search for"
            },
            path: {
              type: "string",
              description: "Directory to search in"
            },
            pattern: {
              type: "string",
              description: 'File glob pattern (e.g., "*.md")'
            }
          },
          required: ["query"]
        }
      },
      {
        name: "search_web",
        description: "Search the web for information.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query"
            }
          },
          required: ["query"]
        }
      }
    ];
  }
  /**
   * Execute a tool call.
   */
  async executeTool(toolName, args) {
    switch (toolName) {
      case "vector_search":
        return this.executeVectorSearch(args);
      case "read_file":
        return this.executeReadFile(args);
      case "list_directory":
        return this.executeListDirectory(args);
      case "search_files":
        return this.executeSearchFiles(args);
      case "search_web":
        return this.executeSearchWeb(args);
      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  }
  /**
   * Execute vector search using RAG.
   */
  async executeVectorSearch(args) {
    const query = String(args.query || "");
    const limit = Number(args.limit) || 5;
    if (!query) {
      return { success: false, error: "Query is required" };
    }
    try {
      const indexManager = getIndexManager();
      const results = await indexManager.search(query, limit);
      const relevantFiles = results.map((r) => ({
        path: r.document.filePath,
        reason: `Matched query: "${query}"`,
        score: r.score,
        snippets: [{
          startLine: r.document.metadata.startLine,
          endLine: r.document.metadata.endLine,
          content: r.document.content,
          headingContext: r.document.metadata.headingContext.join(" > ")
        }]
      }));
      this.eventBus.emit("rag:query", { query, results: relevantFiles });
      this.contextManager.addRelevantFiles(this.type, relevantFiles);
      return {
        success: true,
        result: {
          query,
          results: results.map((r) => ({
            file: r.document.filePath,
            score: r.score.toFixed(3),
            section: r.document.metadata.sectionTitle,
            lines: `${r.document.metadata.startLine}-${r.document.metadata.endLine}`,
            preview: r.document.content.slice(0, 200)
          }))
        }
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
  /**
   * Execute read file.
   */
  async executeReadFile(args) {
    const filePath = String(args.path || "");
    const startLine = args.startLine ? Number(args.startLine) : void 0;
    const endLine = args.endLine ? Number(args.endLine) : void 0;
    if (!filePath) {
      return { success: false, error: "Path is required" };
    }
    try {
      const validatedPath = validateReadPath(filePath, this.workspaceFolders);
      if (!isFile(validatedPath)) {
        return { success: false, error: `File not found: ${filePath}` };
      }
      let content = await fs3.readFile(validatedPath, "utf-8");
      if (startLine !== void 0) {
        const lines = content.split("\n");
        const start = Math.max(0, startLine - 1);
        const end = endLine ? Math.min(lines.length, endLine) : lines.length;
        content = lines.slice(start, end).join("\n");
      }
      const MAX_LENGTH = 5e3;
      if (content.length > MAX_LENGTH) {
        content = content.slice(0, MAX_LENGTH) + "\n... [truncated]";
      }
      return { success: true, result: content };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
  /**
   * Execute list directory.
   */
  async executeListDirectory(args) {
    const dirPath = String(args.path || "");
    const recursive = Boolean(args.recursive);
    if (!dirPath) {
      return { success: false, error: "Path is required" };
    }
    try {
      const validatedPath = validateReadPath(dirPath, this.workspaceFolders);
      if (!isDirectory(validatedPath)) {
        return { success: false, error: `Directory not found: ${dirPath}` };
      }
      const entries = await this.listDir(validatedPath, recursive);
      return { success: true, result: entries };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
  /**
   * List directory contents.
   */
  async listDir(dir, recursive, depth = 0) {
    const MAX_DEPTH = 3;
    const MAX_ENTRIES = 100;
    const entries = [];
    const dirEntries = await fs3.readdir(dir, { withFileTypes: true });
    for (const entry of dirEntries) {
      if (entries.length >= MAX_ENTRIES) break;
      if (entry.name.startsWith(".") || entry.name === "node_modules") {
        continue;
      }
      const fullPath = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        entries.push({
          name: entry.name,
          type: "directory",
          path: fullPath
        });
        if (recursive && depth < MAX_DEPTH) {
          const subEntries = await this.listDir(fullPath, true, depth + 1);
          entries.push(...subEntries.slice(0, MAX_ENTRIES - entries.length));
        }
      } else {
        entries.push({
          name: entry.name,
          type: "file",
          path: fullPath
        });
      }
    }
    return entries;
  }
  /**
   * Execute text search in files.
   */
  async executeSearchFiles(args) {
    const query = String(args.query || "");
    const searchPath = args.path ? String(args.path) : this.workspaceFolders[0];
    const pattern = args.pattern ? String(args.pattern) : "*";
    if (!query) {
      return { success: false, error: "Query is required" };
    }
    if (!searchPath) {
      return { success: false, error: "No workspace folder available" };
    }
    try {
      const validatedPath = validateReadPath(searchPath, this.workspaceFolders);
      const results = await this.searchInDir(validatedPath, query, pattern);
      return { success: true, result: results };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
  /**
   * Search in directory.
   */
  async searchInDir(dir, query, pattern) {
    const MAX_RESULTS = 50;
    const results = [];
    const queryLower = query.toLowerCase();
    const search = async (currentDir) => {
      if (results.length >= MAX_RESULTS) return;
      const entries = await fs3.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= MAX_RESULTS) return;
        if (entry.name.startsWith(".") || entry.name === "node_modules") {
          continue;
        }
        const fullPath = `${currentDir}/${entry.name}`;
        if (entry.isDirectory()) {
          await search(fullPath);
        } else if (this.matchesPattern(entry.name, pattern)) {
          try {
            const content = await fs3.readFile(fullPath, "utf-8");
            const lines = content.split("\n");
            for (let i = 0; i < lines.length && results.length < MAX_RESULTS; i++) {
              if (lines[i].toLowerCase().includes(queryLower)) {
                results.push({
                  file: fullPath,
                  line: i + 1,
                  content: lines[i].trim().slice(0, 200)
                });
              }
            }
          } catch {
          }
        }
      }
    };
    await search(dir);
    return results;
  }
  /**
   * Match filename against glob pattern.
   */
  matchesPattern(filename, pattern) {
    if (pattern === "*") return true;
    const regex = new RegExp(
      "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$",
      "i"
    );
    return regex.test(filename);
  }
  /**
   * Execute web search (placeholder).
   */
  async executeSearchWeb(args) {
    const query = String(args.query || "");
    if (!query) {
      return { success: false, error: "Query is required" };
    }
    return {
      success: false,
      error: "Web search not yet implemented"
    };
  }
};
function createResearchAgent(settings, workspaceFolders = []) {
  const agent = new ResearchAgent(settings, workspaceFolders);
  agent.initialize();
  return agent;
}

// ../../electron/markus/agents/critique.ts
import fs4 from "fs/promises";
function parseReviewIssues(content) {
  const issues = [];
  const reviewRegex = /<review>([\s\S]*?)<\/review>/g;
  let match;
  while ((match = reviewRegex.exec(content)) !== null) {
    const block = match[1];
    const issueRegex = /<issue\s+severity="([^"]+)">([\s\S]*?)<\/issue>/g;
    let issueMatch;
    while ((issueMatch = issueRegex.exec(block)) !== null) {
      const severity = issueMatch[1];
      const description = issueMatch[2].trim();
      const suggestionMatch = block.match(/<suggestion>([\s\S]*?)<\/suggestion>/);
      const suggestion = suggestionMatch ? suggestionMatch[1].trim() : void 0;
      issues.push({ severity, description, suggestion });
    }
  }
  return issues;
}
var CritiqueAgent = class extends BaseAgent {
  type = "critique";
  /** Workspace folders for path validation */
  workspaceFolders = [];
  constructor(settings, workspaceFolders = []) {
    super(settings, agentEventBus, agentContextManager);
    this.workspaceFolders = workspaceFolders;
  }
  /**
   * Update workspace folders.
   */
  setWorkspaceFolders(folders) {
    this.workspaceFolders = folders;
  }
  /**
   * Get tool definitions for the critique agent.
   */
  getToolDefinitions() {
    return [
      {
        name: "read_file",
        description: "Read a file to review its contents.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the file"
            }
          },
          required: ["path"]
        }
      },
      {
        name: "list_directory",
        description: "List files in a directory to find related content.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Directory path"
            }
          },
          required: ["path"]
        }
      }
    ];
  }
  /**
   * Execute a tool call.
   */
  async executeTool(toolName, args) {
    switch (toolName) {
      case "read_file":
        return this.executeReadFile(args);
      case "list_directory":
        return this.executeListDirectory(args);
      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  }
  /**
   * Execute read file.
   */
  async executeReadFile(args) {
    const filePath = String(args.path || "");
    if (!filePath) {
      return { success: false, error: "Path is required" };
    }
    try {
      const validatedPath = validateReadPath(filePath, this.workspaceFolders);
      if (!isFile(validatedPath)) {
        return { success: false, error: `File not found: ${filePath}` };
      }
      let content = await fs4.readFile(validatedPath, "utf-8");
      const MAX_LENGTH = 8e3;
      if (content.length > MAX_LENGTH) {
        content = content.slice(0, MAX_LENGTH) + "\n... [truncated]";
      }
      return { success: true, result: content };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
  /**
   * Execute list directory.
   */
  async executeListDirectory(args) {
    const dirPath = String(args.path || "");
    if (!dirPath) {
      return { success: false, error: "Path is required" };
    }
    try {
      const validatedPath = validateReadPath(dirPath, this.workspaceFolders);
      const entries = await fs4.readdir(validatedPath, { withFileTypes: true });
      const result = entries.filter((e) => !e.name.startsWith(".")).map((e) => ({
        name: e.name,
        type: e.isDirectory() ? "directory" : "file"
      }));
      return { success: true, result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
  /**
   * Review content and return issues.
   */
  async reviewContent(content, context) {
    if (!this.llmClient) {
      throw new Error("Agent not initialized");
    }
    const prompt = `Review the following content for quality issues:

${content}

${context ? `
Context: ${context}` : ""}

Analyze for:
1. Factual accuracy
2. Logical flow
3. Completeness
4. Clarity
5. Contradictions

Provide your review using this format:
<review>
<issue severity="high|medium|low">
Description of issue
</issue>
<suggestion>
How to fix it
</suggestion>
</review>`;
    this.contextManager.addMessage(this.type, {
      role: "user",
      content: prompt
    });
    const messages = this.contextManager.getMessagesForLLM(this.type);
    const response = await this.llmClient.chat(messages);
    const issues = parseReviewIssues(response.content);
    this.contextManager.addMessage(this.type, {
      role: "assistant",
      content: response.content
    });
    return {
      issues,
      summary: response.content
    };
  }
};
function createCritiqueAgent(settings, workspaceFolders = []) {
  const agent = new CritiqueAgent(settings, workspaceFolders);
  agent.initialize();
  return agent;
}

// ../../electron/markus/agents/style.ts
import fs5 from "fs/promises";
function parseStyleIssues(content) {
  const issues = [];
  const regex = /<style_issue>([\s\S]*?)<\/style_issue>/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const block = match[1];
    const locationMatch = block.match(/<location>([\s\S]*?)<\/location>/);
    const issueMatch = block.match(/<issue>([\s\S]*?)<\/issue>/);
    const fixMatch = block.match(/<fix>([\s\S]*?)<\/fix>/);
    if (locationMatch && issueMatch && fixMatch) {
      issues.push({
        location: locationMatch[1].trim(),
        issue: issueMatch[1].trim(),
        fix: fixMatch[1].trim()
      });
    }
  }
  return issues;
}
var StyleAgent = class extends BaseAgent {
  type = "style";
  /** Workspace folders for path validation */
  workspaceFolders = [];
  constructor(settings, workspaceFolders = []) {
    super(settings, agentEventBus, agentContextManager);
    this.workspaceFolders = workspaceFolders;
  }
  /**
   * Update workspace folders.
   */
  setWorkspaceFolders(folders) {
    this.workspaceFolders = folders;
  }
  /**
   * Get tool definitions for the style agent.
   */
  getToolDefinitions() {
    return [
      {
        name: "read_file",
        description: "Read a file to analyze its style.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the file"
            }
          },
          required: ["path"]
        }
      }
    ];
  }
  /**
   * Execute a tool call.
   */
  async executeTool(toolName, args) {
    switch (toolName) {
      case "read_file":
        return this.executeReadFile(args);
      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  }
  /**
   * Execute read file.
   */
  async executeReadFile(args) {
    const filePath = String(args.path || "");
    if (!filePath) {
      return { success: false, error: "Path is required" };
    }
    try {
      const validatedPath = validateReadPath(filePath, this.workspaceFolders);
      if (!isFile(validatedPath)) {
        return { success: false, error: `File not found: ${filePath}` };
      }
      let content = await fs5.readFile(validatedPath, "utf-8");
      const MAX_LENGTH = 6e3;
      if (content.length > MAX_LENGTH) {
        content = content.slice(0, MAX_LENGTH) + "\n... [truncated]";
      }
      return { success: true, result: content };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
  /**
   * Analyze content for style consistency.
   */
  async analyzeStyle(content, styleGuide) {
    if (!this.llmClient) {
      throw new Error("Agent not initialized");
    }
    const prompt = `Analyze the following content for style consistency:

${content}

${styleGuide ? `
Style Guide:
${styleGuide}` : ""}

Check for:
1. Consistent voice (formal/informal)
2. Appropriate tone
3. Heading hierarchy
4. List formatting
5. Link validity

Report issues using this format:
<style_issue>
<location>where in document</location>
<issue>what's wrong</issue>
<fix>suggested correction</fix>
</style_issue>`;
    this.contextManager.addMessage(this.type, {
      role: "user",
      content: prompt
    });
    const messages = this.contextManager.getMessagesForLLM(this.type);
    const response = await this.llmClient.chat(messages);
    const issues = parseStyleIssues(response.content);
    this.contextManager.addMessage(this.type, {
      role: "assistant",
      content: response.content
    });
    return {
      issues,
      summary: response.content
    };
  }
};
function createStyleAgent(settings, workspaceFolders = []) {
  const agent = new StyleAgent(settings, workspaceFolders);
  agent.initialize();
  return agent;
}

// ../../electron/markus/agents/creative.ts
import fs6 from "fs/promises";
function parseIdeas(content) {
  const ideas = [];
  const regex = /<idea>([\s\S]*?)<\/idea>/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const block = match[1];
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
    const descMatch = block.match(/<description>([\s\S]*?)<\/description>/);
    const rationaleMatch = block.match(/<rationale>([\s\S]*?)<\/rationale>/);
    if (titleMatch && descMatch) {
      ideas.push({
        title: titleMatch[1].trim(),
        description: descMatch[1].trim(),
        rationale: rationaleMatch ? rationaleMatch[1].trim() : ""
      });
    }
  }
  return ideas;
}
var CreativeAgent = class extends BaseAgent {
  type = "creative";
  /** Workspace folders for path validation */
  workspaceFolders = [];
  constructor(settings, workspaceFolders = []) {
    super(settings, agentEventBus, agentContextManager);
    this.workspaceFolders = workspaceFolders;
  }
  /**
   * Update workspace folders.
   */
  setWorkspaceFolders(folders) {
    this.workspaceFolders = folders;
  }
  /**
   * Get tool definitions for the creative agent.
   */
  getToolDefinitions() {
    return [
      {
        name: "read_file",
        description: "Read a file for context and inspiration.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the file"
            }
          },
          required: ["path"]
        }
      },
      {
        name: "list_directory",
        description: "List files to understand project structure.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Directory path"
            }
          },
          required: ["path"]
        }
      },
      {
        name: "search_files",
        description: "Search for related content across files.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Text to search for"
            },
            path: {
              type: "string",
              description: "Directory to search in"
            }
          },
          required: ["query"]
        }
      }
    ];
  }
  /**
   * Execute a tool call.
   */
  async executeTool(toolName, args) {
    switch (toolName) {
      case "read_file":
        return this.executeReadFile(args);
      case "list_directory":
        return this.executeListDirectory(args);
      case "search_files":
        return this.executeSearchFiles(args);
      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  }
  /**
   * Execute read file.
   */
  async executeReadFile(args) {
    const filePath = String(args.path || "");
    if (!filePath) {
      return { success: false, error: "Path is required" };
    }
    try {
      const validatedPath = validateReadPath(filePath, this.workspaceFolders);
      if (!isFile(validatedPath)) {
        return { success: false, error: `File not found: ${filePath}` };
      }
      let content = await fs6.readFile(validatedPath, "utf-8");
      const MAX_LENGTH = 8e3;
      if (content.length > MAX_LENGTH) {
        content = content.slice(0, MAX_LENGTH) + "\n... [truncated]";
      }
      return { success: true, result: content };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
  /**
   * Execute list directory.
   */
  async executeListDirectory(args) {
    const dirPath = String(args.path || "");
    if (!dirPath) {
      return { success: false, error: "Path is required" };
    }
    try {
      const validatedPath = validateReadPath(dirPath, this.workspaceFolders);
      if (!isDirectory(validatedPath)) {
        return { success: false, error: `Directory not found: ${dirPath}` };
      }
      const entries = await fs6.readdir(validatedPath, { withFileTypes: true });
      const result = entries.filter((e) => !e.name.startsWith(".") && e.name !== "node_modules").map((e) => ({
        name: e.name,
        type: e.isDirectory() ? "directory" : "file"
      }));
      return { success: true, result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
  /**
   * Execute search files.
   */
  async executeSearchFiles(args) {
    const query = String(args.query || "");
    const searchPath = args.path ? String(args.path) : this.workspaceFolders[0];
    if (!query) {
      return { success: false, error: "Query is required" };
    }
    if (!searchPath) {
      return { success: false, error: "No workspace folder available" };
    }
    try {
      const validatedPath = validateReadPath(searchPath, this.workspaceFolders);
      const results = await this.searchInDir(validatedPath, query);
      return { success: true, result: results };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
  /**
   * Search in directory for matching content.
   */
  async searchInDir(dir, query) {
    const MAX_RESULTS = 30;
    const results = [];
    const queryLower = query.toLowerCase();
    const search = async (currentDir) => {
      if (results.length >= MAX_RESULTS) return;
      const entries = await fs6.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= MAX_RESULTS) return;
        if (entry.name.startsWith(".") || entry.name === "node_modules") {
          continue;
        }
        const fullPath = `${currentDir}/${entry.name}`;
        if (entry.isDirectory()) {
          await search(fullPath);
        } else if (entry.name.endsWith(".md") || entry.name.endsWith(".txt")) {
          try {
            const content = await fs6.readFile(fullPath, "utf-8");
            const lines = content.split("\n");
            for (let i = 0; i < lines.length && results.length < MAX_RESULTS; i++) {
              if (lines[i].toLowerCase().includes(queryLower)) {
                results.push({
                  file: fullPath,
                  line: i + 1,
                  content: lines[i].trim().slice(0, 150)
                });
              }
            }
          } catch {
          }
        }
      }
    };
    await search(dir);
    return results;
  }
  /**
   * Generate ideas based on a topic or context.
   */
  async brainstorm(topic, context, count = 5) {
    if (!this.llmClient) {
      throw new Error("Agent not initialized");
    }
    const prompt = `Generate ${count} creative ideas for the following topic:

Topic: ${topic}

${context ? `Context:
${context}` : ""}

For each idea, provide:
<idea>
<title>Brief title</title>
<description>Detailed explanation</description>
<rationale>Why this works</rationale>
</idea>

Be specific and actionable. Consider multiple angles and approaches.`;
    this.contextManager.addMessage(this.type, {
      role: "user",
      content: prompt
    });
    const messages = this.contextManager.getMessagesForLLM(this.type);
    const response = await this.llmClient.chat(messages);
    const ideas = parseIdeas(response.content);
    this.contextManager.addMessage(this.type, {
      role: "assistant",
      content: response.content
    });
    return {
      ideas,
      summary: response.content
    };
  }
  /**
   * Generate a document outline.
   */
  async generateOutline(topic, requirements) {
    if (!this.llmClient) {
      throw new Error("Agent not initialized");
    }
    const prompt = `Create a detailed outline for a document about:

Topic: ${topic}

${requirements ? `Requirements:
${requirements}` : ""}

Provide a hierarchical markdown outline with:
- Main sections (## headings)
- Subsections (### headings)
- Key points (bullet lists)
- Notes on what each section should cover`;
    this.contextManager.addMessage(this.type, {
      role: "user",
      content: prompt
    });
    const messages = this.contextManager.getMessagesForLLM(this.type);
    const response = await this.llmClient.chat(messages);
    this.contextManager.addMessage(this.type, {
      role: "assistant",
      content: response.content
    });
    return response.content;
  }
};
function createCreativeAgent(settings, workspaceFolders = []) {
  const agent = new CreativeAgent(settings, workspaceFolders);
  agent.initialize();
  return agent;
}

// ../../electron/markus/agents/editor/fuzzyMatch.ts
import { distance as levenshteinDistance } from "fastest-levenshtein";
function normalizeWhitespace(text) {
  return text.split("\n").map((line) => line.trim()).join("\n").replace(/\s+/g, " ").trim();
}
function getLineNumber(content, index) {
  return content.slice(0, index).split("\n").length;
}
function calculateSimilarity(str1, str2) {
  const maxLen = Math.max(str1.length, str2.length);
  if (maxLen === 0) return 1;
  const dist = levenshteinDistance(str1, str2);
  return 1 - dist / maxLen;
}
function exactMatch(content, search) {
  const index = content.indexOf(search);
  if (index === -1) {
    return { found: false, strategy: "exact", confidence: "none" };
  }
  const secondMatch = content.indexOf(search, index + 1);
  if (secondMatch !== -1) {
    return {
      found: true,
      strategy: "exact",
      startIndex: index,
      endIndex: index + search.length,
      lineNumber: getLineNumber(content, index),
      matchedText: search,
      similarity: 1,
      confidence: "low"
      // Multiple matches reduces confidence
    };
  }
  return {
    found: true,
    strategy: "exact",
    startIndex: index,
    endIndex: index + search.length,
    lineNumber: getLineNumber(content, index),
    matchedText: search,
    similarity: 1,
    confidence: "high"
  };
}
function whitespaceNormalizedMatch(content, search) {
  const normalizedSearch = normalizeWhitespace(search);
  const normalizedContent = normalizeWhitespace(content);
  const normalizedIndex = normalizedContent.indexOf(normalizedSearch);
  if (normalizedIndex === -1) {
    return { found: false, strategy: "whitespace", confidence: "none" };
  }
  const lines = content.split("\n");
  const searchLines = search.split("\n").map((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    let matchStart = -1;
    let matched = true;
    for (let j = 0; j < searchLines.length && i + j < lines.length; j++) {
      if (lines[i + j].trim() !== searchLines[j]) {
        matched = false;
        break;
      }
      if (j === 0) {
        matchStart = lines.slice(0, i).join("\n").length + (i > 0 ? 1 : 0);
      }
    }
    if (matched && matchStart >= 0) {
      const matchEnd = lines.slice(0, i + searchLines.length).join("\n").length;
      let multipleMatches = false;
      for (let k = i + 1; k < lines.length; k++) {
        let secondMatch = true;
        for (let j = 0; j < searchLines.length && k + j < lines.length; j++) {
          if (lines[k + j].trim() !== searchLines[j]) {
            secondMatch = false;
            break;
          }
        }
        if (secondMatch) {
          multipleMatches = true;
          break;
        }
      }
      return {
        found: true,
        strategy: "whitespace",
        startIndex: matchStart,
        endIndex: matchEnd,
        lineNumber: i + 1,
        matchedText: lines.slice(i, i + searchLines.length).join("\n"),
        similarity: 0.95,
        confidence: multipleMatches ? "low" : "high"
      };
    }
  }
  return { found: false, strategy: "whitespace", confidence: "none" };
}
function fuzzyLineMatch(content, search, threshold = 0.85) {
  const contentLines = content.split("\n");
  const searchLines = search.split("\n");
  if (searchLines.length === 0) {
    return { found: false, strategy: "fuzzy", confidence: "none" };
  }
  let bestMatch = null;
  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    let totalSimilarity = 0;
    const matchedLines = [];
    for (let j = 0; j < searchLines.length; j++) {
      const contentLine = contentLines[i + j];
      const searchLine = searchLines[j];
      const similarity = calculateSimilarity(
        contentLine.trim(),
        searchLine.trim()
      );
      totalSimilarity += similarity;
      matchedLines.push(contentLine);
    }
    const avgSimilarity = totalSimilarity / searchLines.length;
    if (avgSimilarity >= threshold) {
      if (!bestMatch || avgSimilarity > bestMatch.similarity) {
        bestMatch = {
          startLine: i,
          endLine: i + searchLines.length - 1,
          similarity: avgSimilarity,
          matchedLines
        };
      }
    }
  }
  if (!bestMatch) {
    return { found: false, strategy: "fuzzy", confidence: "none" };
  }
  const startIndex = contentLines.slice(0, bestMatch.startLine).join("\n").length + (bestMatch.startLine > 0 ? 1 : 0);
  const endIndex = startIndex + bestMatch.matchedLines.join("\n").length;
  return {
    found: true,
    strategy: "fuzzy",
    startIndex,
    endIndex,
    lineNumber: bestMatch.startLine + 1,
    matchedText: bestMatch.matchedLines.join("\n"),
    similarity: bestMatch.similarity,
    confidence: bestMatch.similarity >= 0.95 ? "high" : "medium"
  };
}
function anchorMatch(content, search) {
  const searchLines = search.split("\n");
  if (searchLines.length < 2) {
    return { found: false, strategy: "anchor", confidence: "none" };
  }
  const firstLine = searchLines[0].trim();
  const lastLine = searchLines[searchLines.length - 1].trim();
  if (!firstLine || !lastLine) {
    return { found: false, strategy: "anchor", confidence: "none" };
  }
  const contentLines = content.split("\n");
  const startCandidates = [];
  const endCandidates = [];
  for (let i = 0; i < contentLines.length; i++) {
    const trimmedLine = contentLines[i].trim();
    const startSim = calculateSimilarity(trimmedLine, firstLine);
    const endSim = calculateSimilarity(trimmedLine, lastLine);
    if (startSim >= 0.8) {
      startCandidates.push(i);
    }
    if (endSim >= 0.8) {
      endCandidates.push(i);
    }
  }
  let bestMatch = null;
  for (const start of startCandidates) {
    for (const end of endCandidates) {
      if (end <= start) continue;
      const actualLineCount = end - start + 1;
      const expectedLineCount = searchLines.length;
      const lineCountDiff = Math.abs(actualLineCount - expectedLineCount);
      if (lineCountDiff > Math.max(2, expectedLineCount * 0.2)) {
        continue;
      }
      let totalSim = 0;
      const matchLen = Math.min(actualLineCount, expectedLineCount);
      for (let i = 0; i < matchLen; i++) {
        const searchIdx = Math.floor(i * expectedLineCount / matchLen);
        const contentIdx = start + i;
        totalSim += calculateSimilarity(
          contentLines[contentIdx].trim(),
          searchLines[searchIdx].trim()
        );
      }
      const avgSim = totalSim / matchLen;
      if (!bestMatch || avgSim > bestMatch.similarity) {
        bestMatch = { start, end, similarity: avgSim };
      }
    }
  }
  if (!bestMatch || bestMatch.similarity < 0.7) {
    return { found: false, strategy: "anchor", confidence: "none" };
  }
  const matchedLines = contentLines.slice(bestMatch.start, bestMatch.end + 1);
  const startIndex = contentLines.slice(0, bestMatch.start).join("\n").length + (bestMatch.start > 0 ? 1 : 0);
  return {
    found: true,
    strategy: "anchor",
    startIndex,
    endIndex: startIndex + matchedLines.join("\n").length,
    lineNumber: bestMatch.start + 1,
    matchedText: matchedLines.join("\n"),
    similarity: bestMatch.similarity,
    confidence: bestMatch.similarity >= 0.85 ? "medium" : "low"
  };
}
function findMatch(content, search, options = {}) {
  const {
    fuzzyThreshold = 0.85
  } = options;
  if (!search.trim()) {
    return { found: false, strategy: "none", confidence: "none" };
  }
  const exact = exactMatch(content, search);
  if (exact.found && exact.confidence === "high") {
    return exact;
  }
  const whitespace = whitespaceNormalizedMatch(content, search);
  if (whitespace.found && whitespace.confidence === "high") {
    return whitespace;
  }
  const fuzzy = fuzzyLineMatch(content, search, fuzzyThreshold);
  if (fuzzy.found && (fuzzy.confidence === "high" || fuzzy.confidence === "medium")) {
    return fuzzy;
  }
  const anchor = anchorMatch(content, search);
  if (anchor.found) {
    return anchor;
  }
  if (exact.found) return exact;
  if (whitespace.found) return whitespace;
  if (fuzzy.found) return fuzzy;
  return { found: false, strategy: "none", confidence: "none" };
}

// ../../electron/markus/agents/editor/validator.ts
import fs7 from "fs/promises";
import { existsSync as existsSync3 } from "fs";
import path4 from "path";
async function validateEdit(edit, options) {
  const { workspaceFolders, allowCreate = true, minSimilarity = 0.85 } = options;
  let validatedPath;
  try {
    validatedPath = validateWritePath(edit.file, workspaceFolders);
  } catch (error) {
    if (error instanceof PathSecurityError) {
      return {
        valid: false,
        error: `Security error: ${error.message}`
      };
    }
    return {
      valid: false,
      error: `Invalid path: ${edit.file}`
    };
  }
  const isNewFile = !existsSync3(validatedPath);
  if (isNewFile) {
    if (!allowCreate) {
      return {
        valid: false,
        error: `File does not exist: ${edit.file}`
      };
    }
    if (edit.search.trim()) {
      return {
        valid: false,
        error: "For new files, search text must be empty"
      };
    }
    const parentDir = path4.dirname(validatedPath);
    if (!existsSync3(parentDir)) {
      return {
        valid: false,
        error: `Parent directory does not exist: ${parentDir}`
      };
    }
    return {
      valid: true,
      content: "",
      match: {
        found: true,
        strategy: "exact",
        startIndex: 0,
        endIndex: 0,
        lineNumber: 1,
        matchedText: "",
        similarity: 1,
        confidence: "high"
      }
    };
  }
  if (!isFile(validatedPath)) {
    return {
      valid: false,
      error: `Not a file: ${edit.file}`
    };
  }
  let content;
  try {
    content = await fs7.readFile(validatedPath, "utf-8");
  } catch (error) {
    return {
      valid: false,
      error: `Cannot read file: ${error}`
    };
  }
  if (!edit.search.trim()) {
    return {
      valid: true,
      content,
      match: {
        found: true,
        strategy: "exact",
        startIndex: 0,
        endIndex: content.length,
        lineNumber: 1,
        matchedText: content,
        similarity: 1,
        confidence: "high"
      },
      warning: "Empty search will replace entire file content"
    };
  }
  const match = findMatch(content, edit.search, {
    fuzzyThreshold: minSimilarity
  });
  if (!match.found) {
    return {
      valid: false,
      error: "Search text not found in file"
    };
  }
  let warning;
  if (match.confidence === "low") {
    warning = `Low confidence match using ${match.strategy} strategy (similarity: ${match.similarity?.toFixed(2)})`;
  } else if (match.confidence === "medium") {
    warning = `Medium confidence match using ${match.strategy} strategy`;
  }
  return {
    valid: true,
    content,
    match,
    warning
  };
}
async function applyEdit(edit, validation) {
  if (!validation.valid || !validation.match) {
    return {
      success: false,
      error: validation.error || "Invalid edit"
    };
  }
  const { match, content } = validation;
  let newContent;
  if (!content && !edit.search.trim()) {
    newContent = edit.replace;
  } else if (match.startIndex !== void 0 && match.endIndex !== void 0) {
    newContent = content.slice(0, match.startIndex) + edit.replace + content.slice(match.endIndex);
  } else {
    return {
      success: false,
      error: "Invalid match result"
    };
  }
  try {
    await fs7.writeFile(edit.file, newContent, "utf-8");
  } catch (error) {
    return {
      success: false,
      error: `Failed to write file: ${error}`
    };
  }
  return {
    success: true,
    matchStrategy: match.strategy,
    lineNumber: match.lineNumber,
    similarity: match.similarity
  };
}

// ../../electron/markus/agents/editor/editorAgent.ts
import fs8 from "fs/promises";
import { existsSync as existsSync4 } from "fs";
function parseEdits(content) {
  const edits = [];
  const editBlockRegex = /<edit>([\s\S]*?)<\/edit>/g;
  let match;
  while ((match = editBlockRegex.exec(content)) !== null) {
    const block = match[1];
    const fileMatch = block.match(/<file>([\s\S]*?)<\/file>/);
    if (!fileMatch) continue;
    const searchMatch = block.match(/<search>([\s\S]*?)<\/search>/);
    const search = searchMatch ? searchMatch[1].trim() : "";
    const replaceMatch = block.match(/<replace>([\s\S]*?)<\/replace>/);
    const replace = replaceMatch ? replaceMatch[1].trim() : "";
    edits.push({
      file: fileMatch[1].trim(),
      search,
      replace
    });
  }
  return edits;
}
var EditorAgent = class extends BaseAgent {
  type = "editor";
  /** Workspace folders for path validation */
  workspaceFolders = [];
  constructor(settings, workspaceFolders = []) {
    super(settings, agentEventBus, agentContextManager);
    this.workspaceFolders = workspaceFolders;
  }
  /**
   * Update workspace folders.
   */
  setWorkspaceFolders(folders) {
    this.workspaceFolders = folders;
  }
  /**
   * Get tool definitions for the editor agent.
   */
  getToolDefinitions() {
    return [
      {
        name: "read_file",
        description: "Read the contents of a file before editing it.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the file to read"
            }
          },
          required: ["path"]
        }
      },
      {
        name: "edit_file",
        description: "Edit a file using SEARCH/REPLACE. The search text must exist in the file.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the file to edit"
            },
            search: {
              type: "string",
              description: "Text to find (include context for uniqueness)"
            },
            replace: {
              type: "string",
              description: "Text to replace with"
            }
          },
          required: ["path", "search", "replace"]
        }
      },
      {
        name: "create_file",
        description: "Create a new file with the given content.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path for the new file"
            },
            content: {
              type: "string",
              description: "Content to write"
            }
          },
          required: ["path", "content"]
        }
      }
    ];
  }
  /**
   * Execute a tool call.
   */
  async executeTool(toolName, args) {
    switch (toolName) {
      case "read_file":
        return this.executeReadFile(args);
      case "edit_file":
        return this.executeEditFile(args);
      case "create_file":
        return this.executeCreateFile(args);
      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  }
  /**
   * Execute read_file tool.
   */
  async executeReadFile(args) {
    const filePath = String(args.path || "");
    if (!filePath) {
      return { success: false, error: "Path is required" };
    }
    try {
      const validatedPath = validateReadPath(filePath, this.workspaceFolders);
      if (!isFile(validatedPath)) {
        return { success: false, error: `File not found: ${filePath}` };
      }
      const content = await fs8.readFile(validatedPath, "utf-8");
      return { success: true, result: content };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
  /**
   * Execute edit_file tool.
   */
  async executeEditFile(args) {
    const edit = {
      file: String(args.path || ""),
      search: String(args.search || ""),
      replace: String(args.replace || "")
    };
    if (!edit.file) {
      return { success: false, error: "Path is required" };
    }
    const validation = await validateEdit(edit, {
      workspaceFolders: this.workspaceFolders,
      allowCreate: false
    });
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }
    this.eventBus.emit("edit:proposed", {
      edit,
      taskId: this.currentTask?.id || ""
    });
    const result = await applyEdit(edit, validation);
    this.eventBus.emit("edit:applied", { edit, result });
    if (!result.success) {
      return { success: false, error: result.error };
    }
    return {
      success: true,
      result: {
        message: `File edited successfully: ${edit.file}`,
        lineNumber: result.lineNumber,
        strategy: result.matchStrategy,
        similarity: result.similarity
      }
    };
  }
  /**
   * Execute create_file tool.
   */
  async executeCreateFile(args) {
    const filePath = String(args.path || "");
    const content = String(args.content || "");
    if (!filePath) {
      return { success: false, error: "Path is required" };
    }
    const edit = {
      file: filePath,
      search: "",
      // Empty search for new file
      replace: content
    };
    const validation = await validateEdit(edit, {
      workspaceFolders: this.workspaceFolders,
      allowCreate: true
    });
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }
    if (existsSync4(filePath)) {
      return { success: false, error: `File already exists: ${filePath}` };
    }
    try {
      await fs8.writeFile(filePath, content, "utf-8");
    } catch (error) {
      return { success: false, error: `Failed to create file: ${error}` };
    }
    return {
      success: true,
      result: `File created successfully: ${filePath}`
    };
  }
  /**
   * Process edits from LLM response.
   * Parses SEARCH/REPLACE blocks and applies them.
   */
  async processEditsFromResponse(response) {
    const edits = parseEdits(response);
    const results = [];
    const errors = [];
    for (const edit of edits) {
      const validation = await validateEdit(edit, {
        workspaceFolders: this.workspaceFolders,
        allowCreate: true
      });
      if (!validation.valid) {
        errors.push(`${edit.file}: ${validation.error}`);
        results.push({
          success: false,
          error: validation.error
        });
        continue;
      }
      this.eventBus.emit("edit:proposed", {
        edit,
        taskId: this.currentTask?.id || ""
      });
      const result = await applyEdit(edit, validation);
      results.push(result);
      this.eventBus.emit("edit:applied", { edit, result });
      if (!result.success) {
        errors.push(`${edit.file}: ${result.error}`);
      }
    }
    return { edits: results, errors };
  }
};
function createEditorAgent(settings, workspaceFolders = []) {
  const agent = new EditorAgent(settings, workspaceFolders);
  agent.initialize();
  return agent;
}

// ../../electron/markus/agents/generic.ts
var TOOL_PRESETS = {
  "read-only": ["read_file", "list_directory", "search_files"],
  "editor": ["read_file", "list_directory", "search_files", "edit_file", "create_file", "delete_file", "create_directory"],
  "research": ["read_file", "list_directory", "search_files", "search_web", "duck_ai", "vector_search"],
  "full": [
    "read_file",
    "list_directory",
    "search_files",
    "edit_file",
    "create_file",
    "delete_file",
    "create_directory",
    "search_web",
    "duck_ai",
    "vector_search"
  ]
};
var DEFAULT_TOOLS = TOOL_PRESETS["read-only"];
var ALLOWED_GENERIC_TOOLS = /* @__PURE__ */ new Set([
  // File read
  "read_file",
  "list_directory",
  "search_files",
  // File write
  "edit_file",
  "create_file",
  "delete_file",
  "create_directory",
  // Web
  "search_web",
  "duck_ai",
  // RAG
  "vector_search",
  // Context
  "get_open_files",
  "get_workspace_folders",
  // Memory
  "update_memory"
]);
var GenericAgent = class extends BaseAgent {
  // The type is the slug from the agent definition.
  // Cast to AgentType for compatibility with the existing registry/router.
  type;
  /** Human-readable agent name */
  agentName;
  /** Core instructions defining this agent's identity */
  roleDefinition;
  /** Additional per-agent instructions */
  customInstructions;
  /** Which tool names this agent is allowed to use */
  allowedTools;
  /** Workspace folders for path validation */
  workspaceFolders = [];
  constructor(slug, name, roleDefinition, customInstructions, settings, workspaceFolders = [], tools) {
    super(settings, agentEventBus, agentContextManager);
    this.type = slug;
    this.agentName = name;
    this.roleDefinition = roleDefinition;
    this.customInstructions = customInstructions;
    this.workspaceFolders = workspaceFolders;
    const requestedTools = tools ?? DEFAULT_TOOLS;
    this.allowedTools = new Set(
      requestedTools.filter((t) => ALLOWED_GENERIC_TOOLS.has(t))
    );
  }
  /**
   * Update workspace folders.
   */
  setWorkspaceFolders(folders) {
    this.workspaceFolders = folders;
  }
  /**
   * Get tool definitions for this agent.
   * Filters the global TOOL_DEFINITIONS to only include tools this agent is allowed to use.
   */
  getToolDefinitions() {
    return TOOL_DEFINITIONS.filter((def) => this.allowedTools.has(def.name));
  }
  /**
   * Execute a tool call.
   * Validates the tool is in this agent's allowed set, then delegates
   * to the global executeTool() which already handles all tool implementations.
   */
  async executeTool(toolName, args) {
    if (!this.allowedTools.has(toolName)) {
      return { success: false, error: `Tool "${toolName}" is not available to this agent` };
    }
    const context = {
      workspaceFolders: this.workspaceFolders,
      openFiles: [],
      mainWindow: null
    };
    const result = await executeTool(toolName, args, context);
    return {
      success: result.success,
      result: result.result,
      error: result.error
    };
  }
  /**
   * Format a task prompt with roleDefinition and customInstructions prepended.
   */
  formatTaskPrompt(task) {
    let prompt = "";
    prompt += `## Your Role

${this.roleDefinition}

`;
    if (this.customInstructions) {
      prompt += `## Additional Instructions

${this.customInstructions}

`;
    }
    prompt += `## Task

${task.description}
`;
    if (Object.keys(task.context).length > 0) {
      prompt += "\nContext:\n";
      for (const [key, value] of Object.entries(task.context)) {
        prompt += `- ${key}: ${JSON.stringify(value)}
`;
      }
    }
    return prompt;
  }
};
function createGenericAgent(slug, name, roleDefinition, customInstructions, settings, workspaceFolders = [], tools) {
  return new GenericAgent(slug, name, roleDefinition, customInstructions, settings, workspaceFolders, tools);
}

// src/shims/electron.ts
import * as os from "os";
var app = {
  getPath(name) {
    switch (name) {
      case "home":
        return os.homedir();
      case "userData":
        return os.homedir();
      case "appData":
        return os.homedir();
      default:
        return os.homedir();
    }
  }
};

// ../../electron/markus/settings.ts
import path5 from "path";
import fs9 from "fs/promises";
import { existsSync as existsSync5 } from "fs";
import yaml from "js-yaml";

// ../../electron/markus/types.ts
var DEFAULT_MARKUS_SETTINGS = {
  llm: {
    apiEndpoint: "https://api.openai.com/v1/chat/completions",
    apiKey: "",
    model: "gpt-4o-mini",
    maxTokens: 4096,
    temperature: 0.7
  },
  search: {
    useDuckDuckGo: true
  },
  defaultPlanningMode: true,
  yoloMode: false,
  // Multi-agent settings - enabled by default with sensible defaults
  agents: {
    defaults: {
      model: "gpt-4o-mini",
      endpoint: "http://localhost:11434/v1",
      maxTokens: 4096,
      temperature: 0.7
    },
    orchestrator: {
      maxTokens: 8192
    },
    editor: {
      maxTokens: 4096,
      temperature: 0.3
    },
    research: {
      maxTokens: 6144
    },
    critique: {
      maxTokens: 6144
    },
    style: {
      maxTokens: 4096
    },
    creative: {
      maxTokens: 6144,
      temperature: 0.8
    }
  },
  // RAG settings
  rag: {
    enabled: true,
    embeddings: {
      provider: "local",
      model: "all-MiniLM-L6-v2"
    },
    chunking: {
      maxChunkSize: 512,
      overlap: 50
    }
  },
  // Model presets for easy configuration
  modelPresets: {
    "local-small": {
      name: "Local Small (Ministral 8B)",
      endpoint: "http://localhost:11434/v1",
      model: "ministral-8b"
    },
    "local-medium": {
      name: "Local Medium (Devstral 24B)",
      endpoint: "http://localhost:11434/v1",
      model: "devstral-small"
    },
    "openai-mini": {
      name: "OpenAI GPT-4o Mini",
      endpoint: "https://api.openai.com/v1",
      model: "gpt-4o-mini"
    },
    "openai-4o": {
      name: "OpenAI GPT-4o",
      endpoint: "https://api.openai.com/v1",
      model: "gpt-4o"
    }
  }
};

// ../../electron/markus/settings.ts
function getConfigDir() {
  const configDir = process.env.XDG_CONFIG_HOME || path5.join(app.getPath("home"), ".config");
  return path5.join(configDir, "markus-the-editor");
}
function getSettingsPath() {
  return path5.join(getConfigDir(), "settings.yaml");
}
async function ensureConfigDir() {
  const dir = getConfigDir();
  await fs9.mkdir(dir, { recursive: true });
}
async function readSettings() {
  const settingsPath = getSettingsPath();
  if (!existsSync5(settingsPath)) {
    return { ...DEFAULT_MARKUS_SETTINGS };
  }
  try {
    const content = await fs9.readFile(settingsPath, "utf-8");
    const parsed = yaml.load(content);
    return {
      llm: {
        ...DEFAULT_MARKUS_SETTINGS.llm,
        ...parsed?.llm
      },
      search: {
        ...DEFAULT_MARKUS_SETTINGS.search,
        ...parsed?.search
      },
      defaultPlanningMode: parsed?.defaultPlanningMode ?? DEFAULT_MARKUS_SETTINGS.defaultPlanningMode,
      yoloMode: parsed?.yoloMode ?? DEFAULT_MARKUS_SETTINGS.yoloMode,
      // Multi-agent settings (use parsed if present, otherwise use defaults)
      agents: parsed?.agents ? {
        defaults: {
          ...DEFAULT_MARKUS_SETTINGS.agents?.defaults,
          ...parsed.agents.defaults
        },
        orchestrator: parsed.agents.orchestrator,
        editor: parsed.agents.editor,
        research: parsed.agents.research,
        critique: parsed.agents.critique,
        style: parsed.agents.style,
        creative: parsed.agents.creative
      } : DEFAULT_MARKUS_SETTINGS.agents,
      // RAG settings
      rag: parsed?.rag ? {
        ...DEFAULT_MARKUS_SETTINGS.rag,
        ...parsed.rag,
        embeddings: {
          ...DEFAULT_MARKUS_SETTINGS.rag?.embeddings,
          ...parsed.rag.embeddings
        },
        chunking: {
          ...DEFAULT_MARKUS_SETTINGS.rag?.chunking,
          ...parsed.rag.chunking
        }
      } : DEFAULT_MARKUS_SETTINGS.rag,
      // Model presets
      modelPresets: parsed?.modelPresets || DEFAULT_MARKUS_SETTINGS.modelPresets
    };
  } catch (error) {
    console.error("Failed to parse settings.yaml:", error);
    return { ...DEFAULT_MARKUS_SETTINGS };
  }
}
async function writeSettings(settings) {
  await ensureConfigDir();
  const settingsPath = getSettingsPath();
  const yamlContent = yaml.dump(settings, {
    indent: 2,
    lineWidth: 120,
    quotingType: '"',
    forceQuotes: false
  });
  await fs9.writeFile(settingsPath, yamlContent, "utf-8");
}
async function ensureSettingsFile() {
  await ensureConfigDir();
  const settingsPath = getSettingsPath();
  if (existsSync5(settingsPath)) {
    return;
  }
  const defaultContent = `# Markus AI Agent Settings
# This file configures the Markus AI assistant in the editor.

# LLM Configuration
# Supports OpenAI, Anthropic, and OpenAI-compatible APIs (local models, etc.)
llm:
  # API endpoint URL
  # For OpenAI: https://api.openai.com/v1/chat/completions
  # For Anthropic: https://api.anthropic.com/v1/messages
  # For Ollama: http://localhost:11434/v1
  apiEndpoint: "https://api.openai.com/v1/chat/completions"
  # API key (keep this secret!)
  apiKey: ""
  # Model to use
  # OpenAI: gpt-4o-mini, gpt-4o, gpt-4-turbo
  # Anthropic: claude-3-5-sonnet-20241022, claude-3-opus-20240229
  # Ollama: devstral, ministral, llama3.1
  model: "gpt-4o-mini"
  # Maximum tokens for response
  maxTokens: 4096
  # Temperature (0-2 for OpenAI, 0-1 for Anthropic)
  temperature: 0.7

# Web Search Configuration
search:
  # SearxNG instance URL (optional, for privacy-respecting search)
  # searxngUrl: "https://your-searxng-instance.com"
  # Use DuckDuckGo AI for quick answers
  useDuckDuckGo: true

# Mode Settings
# Planning mode requires approval before executing tools
defaultPlanningMode: true
# YOLO mode executes all tools without approval (use with caution!)
yoloMode: false

# Multi-Agent System Configuration
# Each agent can use a different model. Smaller models work well for specialized tasks.
# Uncomment and configure to enable multi-agent mode.
#
# agents:
#   # Default settings for all agents (used when agent-specific settings not provided)
#   defaults:
#     model: "ministral-8b"
#     endpoint: "http://localhost:11434/v1"
#     maxTokens: 4096
#     temperature: 0.7
#
#   # Orchestrator: coordinates tasks (recommended: larger model)
#   orchestrator:
#     model: "devstral-small"
#     maxTokens: 8192
#
#   # Editor: file modifications (recommended: small model, low temperature)
#   editor:
#     temperature: 0.3
#
#   # Research: file search and RAG queries
#   research:
#     maxTokens: 6144
#
#   # Critique: quality review
#   critique:
#     maxTokens: 6144
#
#   # Style: formatting consistency
#   style:
#     maxTokens: 4096
#
#   # Creative: ideas and brainstorming (recommended: larger model)
#   creative:
#     model: "devstral-small"
#     temperature: 0.8

# RAG (Retrieval-Augmented Generation) Settings
# Enables semantic search across your documents
rag:
  enabled: true
  embeddings:
    # Provider: "local" (ONNX), "api" (use LLM endpoint), "tfidf" (fallback)
    provider: "local"
    model: "all-MiniLM-L6-v2"
  chunking:
    maxChunkSize: 512
    overlap: 50

# Model Presets for quick configuration
modelPresets:
  local-small:
    name: "Local Small (Ministral 8B)"
    endpoint: "http://localhost:11434/v1"
    model: "ministral-8b"
  local-medium:
    name: "Local Medium (Devstral 24B)"
    endpoint: "http://localhost:11434/v1"
    model: "devstral-small"
  openai-mini:
    name: "OpenAI GPT-4o Mini"
    endpoint: "https://api.openai.com/v1"
    model: "gpt-4o-mini"
  openai-4o:
    name: "OpenAI GPT-4o"
    endpoint: "https://api.openai.com/v1"
    model: "gpt-4o"
`;
  await fs9.writeFile(settingsPath, defaultContent, "utf-8");
}
function validateSettings(settings) {
  const errors = [];
  if (!settings.llm.apiEndpoint) {
    errors.push("LLM API endpoint is not configured");
  }
  if (!settings.llm.apiKey) {
    errors.push("LLM API key is not configured");
  }
  if (!settings.llm.model) {
    errors.push("LLM model is not configured");
  }
  return {
    valid: errors.length === 0,
    errors
  };
}
function getAgentSettings(settings, agentType) {
  const agents = settings.agents || DEFAULT_MARKUS_SETTINGS.agents;
  const defaults = agents.defaults || {};
  const agentSpecific = agents[agentType] || {};
  return {
    model: agentSpecific.model || defaults.model || settings.llm.model,
    endpoint: agentSpecific.endpoint || defaults.endpoint || settings.llm.apiEndpoint,
    apiKey: agentSpecific.apiKey || defaults.apiKey || settings.llm.apiKey,
    maxTokens: agentSpecific.maxTokens || defaults.maxTokens || settings.llm.maxTokens || 4096,
    temperature: agentSpecific.temperature ?? defaults.temperature ?? settings.llm.temperature ?? 0.7,
    timeout: agentSpecific.timeout || defaults.timeout || 6e4
  };
}
function getRAGSettings(settings) {
  return settings.rag || DEFAULT_MARKUS_SETTINGS.rag;
}
function isMultiAgentEnabled(settings) {
  return !!settings.agents;
}

// ../../electron/markus/multiAgent.ts
var state = {
  initialized: false,
  router: null,
  indexManager: null,
  workspaceFolders: [],
  settings: null
};
var conversationStates = /* @__PURE__ */ new Map();
async function initializeMultiAgentSystem(settings, workspaceFolders) {
  if (state.initialized) {
    console.log("[MultiAgent] Already initialized");
    return;
  }
  console.log("[MultiAgent] Initializing multi-agent system...");
  state.settings = settings;
  state.workspaceFolders = workspaceFolders;
  agentContextManager.setWorkspaceFolders(workspaceFolders);
  const agentSettings = settings.agents || {
    defaults: {
      model: settings.llm.model,
      endpoint: settings.llm.apiEndpoint,
      apiKey: settings.llm.apiKey,
      maxTokens: settings.llm.maxTokens || 4096,
      temperature: settings.llm.temperature || 0.7
    }
  };
  state.router = getAgentRouter(agentSettings);
  const agents = createAllAgents(settings, workspaceFolders);
  for (const agent of agents) {
    state.router.registerAgent(agent);
  }
  const orchestrator = agents.find((a) => a.type === "orchestrator");
  if (orchestrator) {
    orchestrator.setRouter(state.router);
  }
  const ragSettings = getRAGSettings(settings);
  if (ragSettings.enabled) {
    const configDir = getConfigDir();
    state.indexManager = getIndexManager(ragSettings, configDir);
    await state.indexManager.initialize(workspaceFolders);
    state.indexManager.indexWorkspace().catch((err) => {
      console.error("[MultiAgent] RAG indexing error:", err);
    });
  }
  state.initialized = true;
  console.log("[MultiAgent] Multi-agent system initialized");
}
function createAllAgents(settings, workspaceFolders) {
  const agents = [];
  const orchestratorSettings = getAgentSettings(settings, "orchestrator");
  agents.push(createOrchestratorAgent(orchestratorSettings, workspaceFolders));
  const editorSettings = getAgentSettings(settings, "editor");
  agents.push(createEditorAgent(editorSettings, workspaceFolders));
  const researchSettings = getAgentSettings(settings, "research");
  agents.push(createResearchAgent(researchSettings, workspaceFolders));
  const critiqueSettings = getAgentSettings(settings, "critique");
  agents.push(createCritiqueAgent(critiqueSettings, workspaceFolders));
  const styleSettings = getAgentSettings(settings, "style");
  agents.push(createStyleAgent(styleSettings, workspaceFolders));
  const creativeSettings = getAgentSettings(settings, "creative");
  agents.push(createCreativeAgent(creativeSettings, workspaceFolders));
  return agents;
}
async function initializeForConversation(conversationId, agentDefinitions, settings, workspaceFolders) {
  if (conversationStates.has(conversationId)) {
    console.log(`[MultiAgent] Conversation ${conversationId} already initialized`);
    return;
  }
  console.log(`[MultiAgent] Initializing per-conversation agents for ${conversationId}...`);
  const routerSettings = {
    defaults: {
      model: settings.llm.model,
      endpoint: settings.llm.apiEndpoint,
      apiKey: settings.llm.apiKey,
      maxTokens: settings.llm.maxTokens || 4096,
      temperature: settings.llm.temperature || 0.7
    }
  };
  const router = new AgentRouter(routerSettings);
  const agents = [];
  for (const def of agentDefinitions) {
    const agentSettings = {
      model: def.model,
      endpoint: def.endpoint,
      apiKey: def.apiKey,
      maxTokens: def.maxTokens,
      temperature: def.temperature,
      timeout: def.timeout
    };
    const agent = createGenericAgent(
      def.slug,
      def.name,
      def.roleDefinition,
      def.customInstructions,
      agentSettings,
      workspaceFolders,
      def.tools
    );
    agents.push(agent);
    router.registerAgent(agent);
  }
  const convState = {
    initialized: true,
    router,
    indexManager: null,
    workspaceFolders,
    settings,
    agents
  };
  const ragSettings = getRAGSettings(settings);
  if (ragSettings.enabled) {
    const configDir = getConfigDir();
    convState.indexManager = getIndexManager(ragSettings, configDir);
    await convState.indexManager.initialize(workspaceFolders);
    convState.indexManager.indexWorkspace().catch((err) => {
      console.error(`[MultiAgent] RAG indexing error (conv ${conversationId}):`, err);
    });
  }
  conversationStates.set(conversationId, convState);
  console.log(`[MultiAgent] Per-conversation agents initialized for ${conversationId} (${agents.length} agents)`);
}
function shutdownConversation(conversationId) {
  const convState = conversationStates.get(conversationId);
  if (!convState) return;
  if (convState.router) {
    convState.router.shutdown();
  }
  if (convState.indexManager) {
    convState.indexManager.save().catch((err) => {
      console.error(`[MultiAgent] Failed to save RAG index (conv ${conversationId}):`, err);
    });
  }
  conversationStates.delete(conversationId);
  console.log(`[MultiAgent] Conversation ${conversationId} shutdown`);
}
function isInitializedForConversation(conversationId) {
  return conversationStates.get(conversationId)?.initialized ?? false;
}
function getConversationAgents(conversationId) {
  return conversationStates.get(conversationId)?.agents ?? [];
}
function shutdownMultiAgentSystem() {
  if (state.router) {
    state.router.shutdown();
    resetAgentRouter();
    state.router = null;
  }
  if (state.indexManager) {
    state.indexManager.save().catch((err) => {
      console.error("[MultiAgent] Failed to save RAG index:", err);
    });
    resetIndexManager();
    state.indexManager = null;
  }
  for (const [convId] of conversationStates) {
    shutdownConversation(convId);
  }
  state.initialized = false;
  state.settings = null;
  state.workspaceFolders = [];
  console.log("[MultiAgent] Multi-agent system shutdown");
}
async function routeUserMessage(message, context = {}) {
  if (!state.router) {
    console.error("[MultiAgent] System not initialized");
    return null;
  }
  return state.router.routeUserMessage(message, {
    ...context,
    workspaceFolders: state.workspaceFolders
  });
}
function getRAGIndexStatus() {
  if (state.indexManager) {
    return state.indexManager.getStatus();
  }
  return null;
}
async function reindexWorkspace() {
  if (state.indexManager) {
    await state.indexManager.indexWorkspace();
  }
}
function isInitialized() {
  return state.initialized;
}
async function searchRAG(query, limit = 10, conversationId) {
  const indexManager = conversationId ? conversationStates.get(conversationId)?.indexManager ?? state.indexManager : state.indexManager;
  if (!indexManager) {
    return [];
  }
  const results = await indexManager.search(query, limit);
  return results.map((r) => ({
    filePath: r.document.filePath,
    content: r.document.content,
    score: r.score,
    startLine: r.document.metadata.startLine,
    endLine: r.document.metadata.endLine
  }));
}
function getConversationIndexManager(conversationId) {
  return conversationStates.get(conversationId)?.indexManager ?? null;
}

// ../../electron/markus/tasks.ts
import path6 from "path";
import fs10 from "fs/promises";
import { existsSync as existsSync6 } from "fs";
function getTasksDir(workspaceId) {
  return path6.join(getConfigDir(), "workspaces", workspaceId, "tasks");
}
async function ensureTasksDir(workspaceId) {
  const dir = getTasksDir(workspaceId);
  await fs10.mkdir(dir, { recursive: true });
  return dir;
}
function getTaskListPath(workspaceId, conversationId) {
  return path6.join(getTasksDir(workspaceId), `${conversationId}.json`);
}
function cleanupTaskList(taskList) {
  const seenDescriptions = /* @__PURE__ */ new Map();
  const cleanedTasks = [];
  for (const task of taskList.tasks) {
    const normalizedDesc = task.description.toLowerCase().trim();
    const existing = seenDescriptions.get(normalizedDesc);
    if (existing) {
      if (task.status === "done" && existing.status !== "done") {
        const idx = cleanedTasks.indexOf(existing);
        cleanedTasks[idx] = task;
        seenDescriptions.set(normalizedDesc, task);
      }
      continue;
    }
    seenDescriptions.set(normalizedDesc, task);
    cleanedTasks.push(task);
  }
  const needsReindex = cleanedTasks.some((t) => !t.id.match(/^t\d+$/));
  if (needsReindex) {
    cleanedTasks.forEach((task, idx) => {
      task.id = `t${idx + 1}`;
    });
  }
  taskList.tasks = cleanedTasks;
  taskList.updatedAt = Date.now();
}
async function loadTaskList(workspaceId, conversationId) {
  const filePath = getTaskListPath(workspaceId, conversationId);
  if (!existsSync6(filePath)) {
    return null;
  }
  try {
    const content = await fs10.readFile(filePath, "utf-8");
    const taskList = JSON.parse(content);
    const originalCount = taskList.tasks.length;
    cleanupTaskList(taskList);
    if (taskList.tasks.length !== originalCount) {
      console.log(`[Markus] Cleaned up ${originalCount - taskList.tasks.length} duplicate tasks`);
      await saveTaskList(workspaceId, taskList);
    }
    return taskList;
  } catch (error) {
    console.error("[Markus] Failed to load task list:", error);
    return null;
  }
}
async function saveTaskList(workspaceId, taskList) {
  await ensureTasksDir(workspaceId);
  const filePath = getTaskListPath(workspaceId, taskList.conversationId);
  taskList.updatedAt = Date.now();
  await fs10.writeFile(filePath, JSON.stringify(taskList, null, 2), "utf-8");
}
function createTaskList(conversationId) {
  const now = Date.now();
  return {
    conversationId,
    tasks: [],
    createdAt: now,
    updatedAt: now
  };
}
function generateShortId(taskList) {
  let maxNum = 0;
  for (const task of taskList.tasks) {
    const match = task.id.match(/^t(\d+)$/);
    if (match) {
      maxNum = Math.max(maxNum, parseInt(match[1], 10));
    }
  }
  return `t${maxNum + 1}`;
}
function addTask(taskList, description, priority = 0) {
  const normalizedDesc = description.toLowerCase().trim();
  const existing = taskList.tasks.find(
    (t) => t.description.toLowerCase().trim() === normalizedDesc && t.status !== "done"
  );
  if (existing) {
    if (priority > existing.priority) {
      existing.priority = priority;
      taskList.updatedAt = Date.now();
    }
    return existing;
  }
  const task = {
    id: generateShortId(taskList),
    description,
    status: "pending",
    priority
  };
  taskList.tasks.push(task);
  taskList.updatedAt = Date.now();
  return task;
}
function updateTaskStatus(taskList, taskId, status, blockedBy) {
  const task = taskList.tasks.find((t) => t.id === taskId);
  if (!task) return false;
  task.status = status;
  if (status === "done") {
    task.completedAt = Date.now();
  }
  if (blockedBy !== void 0) {
    task.blockedBy = blockedBy;
  }
  taskList.updatedAt = Date.now();
  return true;
}
function updateTaskDescription(taskList, taskId, description) {
  const task = taskList.tasks.find((t) => t.id === taskId);
  if (!task) return false;
  task.description = description;
  taskList.updatedAt = Date.now();
  return true;
}
function removeTask(taskList, taskId) {
  const index = taskList.tasks.findIndex((t) => t.id === taskId);
  if (index === -1) return false;
  taskList.tasks.splice(index, 1);
  taskList.updatedAt = Date.now();
  return true;
}
function completeTasks(taskList, taskIds) {
  let completed = 0;
  for (const taskId of taskIds) {
    if (updateTaskStatus(taskList, taskId, "done")) {
      completed++;
    }
  }
  return completed;
}
function formatTaskListForPrompt(taskList) {
  if (!taskList || taskList.tasks.length === 0) {
    return "No tasks defined yet. Use update_tasks to create your task list.";
  }
  const pending = taskList.tasks.filter((t) => t.status === "pending");
  const inProgress = taskList.tasks.filter((t) => t.status === "in_progress");
  const done = taskList.tasks.filter((t) => t.status === "done");
  const blocked = taskList.tasks.filter((t) => t.status === "blocked");
  let output = "## Current Tasks\n\n";
  output += "Use the task ID when calling update_tasks with complete/update/remove.\n\n";
  if (inProgress.length > 0) {
    output += "### In Progress\n";
    for (const task of inProgress) {
      output += `- [~] (${task.id}) ${task.description}
`;
    }
    output += "\n";
  }
  if (pending.length > 0) {
    output += "### Pending\n";
    for (const task of pending) {
      output += `- [ ] (${task.id}) ${task.description}
`;
    }
    output += "\n";
  }
  if (blocked.length > 0) {
    output += "### Blocked\n";
    for (const task of blocked) {
      output += `- [!] (${task.id}) ${task.description}${task.blockedBy ? ` (blocked: ${task.blockedBy})` : ""}
`;
    }
    output += "\n";
  }
  if (done.length > 0) {
    output += "### Done\n";
    for (const task of done) {
      output += `- [x] (${task.id}) ${task.description}
`;
    }
    output += "\n";
  }
  const stats = `Progress: ${done.length}/${taskList.tasks.length} tasks complete`;
  output += `
${stats}`;
  return output;
}

// ../../electron/markus/tools.ts
var TOOL_DEFINITIONS = [
  {
    name: "read_file",
    description: "Read the contents of a file. Returns the file content as text.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute or relative path to the file to read"
        }
      },
      required: ["path"]
    }
  },
  {
    name: "list_directory",
    description: "List files and directories in a given path.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the directory to list"
        },
        recursive: {
          type: "boolean",
          description: "Whether to list recursively (default: false)"
        }
      },
      required: ["path"]
    }
  },
  {
    name: "edit_file",
    description: "Edit a file by replacing a specific string with a new string. The old_string must exist in the file.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file to edit"
        },
        old_string: {
          type: "string",
          description: "The exact string to find and replace"
        },
        new_string: {
          type: "string",
          description: "The string to replace it with"
        }
      },
      required: ["path", "old_string", "new_string"]
    }
  },
  {
    name: "create_file",
    description: "Create a new file with the given content. The file will be opened in the editor.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path for the new file"
        },
        content: {
          type: "string",
          description: "Content to write to the file"
        }
      },
      required: ["path", "content"]
    }
  },
  {
    name: "delete_file",
    description: "Delete a file from the filesystem.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file to delete"
        }
      },
      required: ["path"]
    }
  },
  {
    name: "create_directory",
    description: "Create a new directory.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path for the new directory"
        }
      },
      required: ["path"]
    }
  },
  {
    name: "search_files",
    description: "Search for text patterns in files within a directory.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Text pattern to search for"
        },
        path: {
          type: "string",
          description: "Directory to search in (optional, defaults to first workspace folder)"
        },
        file_pattern: {
          type: "string",
          description: 'File glob pattern to match (e.g., "*.ts", "*.md")'
        }
      },
      required: ["query"]
    }
  },
  {
    name: "search_web",
    description: "Search the web using SearxNG. Requires SearxNG to be configured.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query"
        }
      },
      required: ["query"]
    }
  },
  {
    name: "vector_search",
    description: "Semantic search across indexed workspace files. Returns relevant chunks with similarity scores. Requires RAG indexing to be enabled.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural language search query"
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return (default: 5)"
        }
      },
      required: ["query"]
    }
  },
  {
    name: "duck_ai",
    description: "Get a quick answer using DuckDuckGo AI.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Question to ask"
        }
      },
      required: ["query"]
    }
  },
  {
    name: "get_open_files",
    description: "Get the list of currently open files in the editor.",
    parameters: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "get_workspace_folders",
    description: "Get the list of workspace folders currently open in the workspace.",
    parameters: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "update_memory",
    description: "Update Markus memory to remember information for future conversations. Requires user confirmation.",
    parameters: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          description: 'Where to store: "system" (global) or "project" (workspace-specific)',
          enum: ["system", "project"]
        },
        action: {
          type: "string",
          description: 'What to do: "add", "update", or "remove"',
          enum: ["add", "update", "remove"]
        },
        section: {
          type: "string",
          description: 'Section header for the memory (e.g., "User Preferences", "Project Context")'
        },
        content: {
          type: "string",
          description: "Content to add/update in this section"
        }
      },
      required: ["scope", "action", "section", "content"]
    }
  },
  // Agent delegation tools - consult specialist agents for specific tasks
  {
    name: "consult_research_agent",
    description: "Ask the Research agent to search files, analyze code, or gather information. Use for deep file exploration and understanding.",
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "What you want the research agent to find or analyze"
        },
        context: {
          type: "string",
          description: "Additional context about what you are working on"
        }
      },
      required: ["task"]
    }
  },
  {
    name: "consult_critique_agent",
    description: "Ask the Critique agent to review content, check for issues, or validate your work. Use for quality assurance.",
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "What you want reviewed or critiqued"
        },
        content: {
          type: "string",
          description: "The content to review (optional if referring to a file)"
        }
      },
      required: ["task"]
    }
  },
  {
    name: "consult_style_agent",
    description: "Ask the Style agent to improve formatting, voice, tone, or consistency. Use for polishing text.",
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "What style improvements you need"
        },
        content: {
          type: "string",
          description: "The content to style (optional if referring to a file)"
        }
      },
      required: ["task"]
    }
  },
  {
    name: "consult_creative_agent",
    description: "Ask the Creative agent for ideas, brainstorming, or creative solutions. Use for generating options or thinking outside the box.",
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "What creative input you need"
        },
        context: {
          type: "string",
          description: "Background context for the creative task"
        }
      },
      required: ["task"]
    }
  },
  // Thought loop tools - for proactive agent behavior
  {
    name: "consult_boss",
    description: "Show a message to the user. The boss can ONLY see content inside this tool call. Any text outside tool calls is invisible to the user. Use this to communicate progress, findings, or results.",
    parameters: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "The message to display to the user (supports markdown)"
        },
        type: {
          type: "string",
          description: "Message type for styling",
          enum: ["info", "success", "warning", "error", "progress"]
        }
      },
      required: ["message"]
    }
  },
  {
    name: "update_tasks",
    description: "Update the task list. Call this first in each iteration to track your progress and maintain focus.",
    parameters: {
      type: "object",
      properties: {
        add: {
          type: "array",
          description: 'Tasks to add, e.g. [{"description": "Do something", "priority": 5}]. Priority is optional (higher = more important).'
        },
        complete: {
          type: "array",
          description: 'Task IDs to mark as done, e.g. ["t1", "t3"]. Use IDs shown in parentheses in the task list.'
        },
        remove: {
          type: "array",
          description: 'Task IDs to remove, e.g. ["t2"]. Use IDs shown in parentheses in the task list.'
        },
        update: {
          type: "array",
          description: 'Tasks to update, e.g. [{"id": "t1", "status": "in_progress"}]. Status can be "pending", "in_progress", "blocked", or "done". Description is also updatable.'
        }
      }
    }
  },
  {
    name: "ask_user",
    description: "Ask the user a question with predefined clickable options. This PAUSES the thought loop until the user responds. Use sparingly - only when you truly need user input to proceed.",
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The question to ask the user"
        },
        options: {
          type: "array",
          description: 'Clickable options (2-5). An "Other" option with text input is always added automatically.'
        },
        reason: {
          type: "string",
          description: "Brief explanation of why this input is needed"
        }
      },
      required: ["question", "options"]
    }
  },
  {
    name: "request_task_approval",
    description: "Request approval when all tasks are complete. This PAUSES the thought loop for user review. Only call this when you have finished all the work.",
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Summary of the completed work"
        },
        files_changed: {
          type: "array",
          description: "List of files that were modified"
        }
      },
      required: ["summary"]
    }
  }
];
var MAX_FILE_CONTENT_LENGTH = 1e4;
var MAX_DIRECTORY_ENTRIES = 100;
var MAX_DIRECTORY_DEPTH = 3;
var MAX_SEARCH_RESULTS = 50;
function truncateResult(content, maxLength = MAX_FILE_CONTENT_LENGTH) {
  if (content.length <= maxLength) {
    return content;
  }
  return content.substring(0, maxLength) + `

[... truncated, ${content.length - maxLength} more characters ...]`;
}
async function executeTool(toolName, args, context) {
  try {
    switch (toolName) {
      case "read_file":
        return await executeReadFile(args, context);
      case "list_directory":
        return await executeListDirectory(args, context);
      case "edit_file":
        return await executeEditFile(args, context);
      case "create_file":
        return await executeCreateFile(args, context);
      case "delete_file":
        return await executeDeleteFile(args, context);
      case "create_directory":
        return await executeCreateDirectory(args, context);
      case "search_files":
        return await executeSearchFiles(args, context);
      case "search_web":
        return await executeSearchWeb(args);
      case "vector_search":
        return await executeVectorSearch(args, context);
      case "duck_ai":
        return await executeDuckAi(args);
      case "get_open_files":
        return executeGetOpenFiles(context);
      case "get_workspace_folders":
        return executeGetWorkspaceFolders(context);
      case "update_memory":
        return await executeUpdateMemory(args);
      case "consult_research_agent":
        return await executeConsultAgent("research", args, context);
      case "consult_critique_agent":
        return await executeConsultAgent("critique", args, context);
      case "consult_style_agent":
        return await executeConsultAgent("style", args, context);
      case "consult_creative_agent":
        return await executeConsultAgent("creative", args, context);
      case "consult_boss":
        return executeConsultBoss(args);
      case "update_tasks":
        return await executeUpdateTasks(args, context);
      case "ask_user":
        return executeAskUser(args);
      case "request_task_approval":
        return executeRequestApproval(args);
      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (error) {
    if (error instanceof PathSecurityError) {
      return { success: false, error: error.message };
    }
    return { success: false, error: String(error) };
  }
}
async function executeReadFile(args, context) {
  const filePath = String(args.path || "");
  if (!filePath) {
    return { success: false, error: "Path is required" };
  }
  const validatedPath = validateReadPath(filePath, context.workspaceFolders);
  if (!isFile(validatedPath)) {
    return { success: false, error: `File not found: ${filePath}` };
  }
  const content = await fs11.readFile(validatedPath, "utf-8");
  const formattedResult = `File: ${filePath}
${"\u2500".repeat(40)}
${truncateResult(content)}`;
  return { success: true, result: formattedResult };
}
async function executeListDirectory(args, context) {
  const dirPath = String(args.path || "");
  const recursive = Boolean(args.recursive);
  if (!dirPath) {
    return { success: false, error: "Path is required" };
  }
  const validatedPath = validateDirectoryPath(dirPath, context.workspaceFolders);
  if (!isDirectory(validatedPath)) {
    return { success: false, error: `Directory not found: ${dirPath}` };
  }
  const entries = await listDirectoryRecursive(validatedPath, recursive, 0);
  if (entries.length >= MAX_DIRECTORY_ENTRIES) {
    return {
      success: true,
      result: entries,
      warning: `Results limited to ${MAX_DIRECTORY_ENTRIES} entries. Use a more specific path to see more.`
    };
  }
  return { success: true, result: entries };
}
async function listDirectoryRecursive(dirPath, recursive, currentDepth, basePath) {
  const entries = await fs11.readdir(dirPath, { withFileTypes: true });
  const result = [];
  const base = basePath || dirPath;
  for (const entry of entries) {
    if (result.length >= MAX_DIRECTORY_ENTRIES) {
      break;
    }
    if (entry.name.startsWith(".") || entry.name === "node_modules") {
      continue;
    }
    const fullPath = path7.join(dirPath, entry.name);
    const relativePath = path7.relative(base, fullPath);
    if (entry.isDirectory()) {
      result.push({ name: entry.name, path: relativePath, type: "directory" });
      if (recursive && currentDepth < MAX_DIRECTORY_DEPTH && result.length < MAX_DIRECTORY_ENTRIES) {
        try {
          const subEntries = await listDirectoryRecursive(fullPath, true, currentDepth + 1, base);
          const remaining = MAX_DIRECTORY_ENTRIES - result.length;
          result.push(...subEntries.slice(0, remaining));
        } catch {
        }
      }
    } else {
      result.push({ name: entry.name, path: relativePath, type: "file" });
    }
  }
  return result;
}
async function executeEditFile(args, context) {
  const filePath = String(args.path || "");
  const oldString = String(args.old_string || "");
  const newString = String(args.new_string || "");
  if (!filePath) {
    return { success: false, error: "Path is required" };
  }
  if (!oldString) {
    return { success: false, error: "old_string is required" };
  }
  const validatedPath = validateWritePath(filePath, context.workspaceFolders);
  if (!isFile(validatedPath)) {
    return { success: false, error: `File not found: ${filePath}` };
  }
  const content = await fs11.readFile(validatedPath, "utf-8");
  const validation = validateEditOperation(filePath, oldString, content);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }
  if (validation.occurrences > 1) {
    return {
      success: false,
      error: `The string to replace occurs ${validation.occurrences} times. Please provide more context to make it unique.`
    };
  }
  const newContent = content.replace(oldString, newString);
  await fs11.writeFile(validatedPath, newContent, "utf-8");
  return {
    success: true,
    result: `File edited successfully: ${filePath}`,
    openFile: validatedPath
  };
}
async function executeCreateFile(args, context) {
  const filePath = String(args.path || "");
  const content = String(args.content || "");
  if (!filePath) {
    return { success: false, error: "Path is required" };
  }
  const validatedPath = validateWritePath(filePath, context.workspaceFolders);
  if (existsSync7(validatedPath)) {
    return { success: false, error: `File already exists: ${filePath}. Use edit_file to modify it.` };
  }
  await fs11.writeFile(validatedPath, content, "utf-8");
  return {
    success: true,
    result: `File created successfully: ${filePath}`,
    openFile: validatedPath
  };
}
async function executeDeleteFile(args, context) {
  const filePath = String(args.path || "");
  if (!filePath) {
    return { success: false, error: "Path is required" };
  }
  const validatedPath = validateWritePath(filePath, context.workspaceFolders);
  if (!existsSync7(validatedPath)) {
    return { success: false, error: `File not found: ${filePath}` };
  }
  await fs11.unlink(validatedPath);
  return { success: true, result: `File deleted successfully: ${filePath}` };
}
async function executeCreateDirectory(args, context) {
  const dirPath = String(args.path || "");
  if (!dirPath) {
    return { success: false, error: "Path is required" };
  }
  const validatedPath = validateDirectoryPath(dirPath, context.workspaceFolders);
  if (existsSync7(validatedPath)) {
    return { success: false, error: `Directory already exists: ${dirPath}` };
  }
  await fs11.mkdir(validatedPath, { recursive: true });
  return { success: true, result: `Directory created successfully: ${dirPath}` };
}
async function executeSearchFiles(args, context) {
  const query = String(args.query || "");
  const searchPath = args.path ? String(args.path) : context.workspaceFolders[0];
  const filePattern = args.file_pattern ? String(args.file_pattern) : "*";
  if (!query) {
    return { success: false, error: "Query is required" };
  }
  if (!searchPath) {
    return { success: false, error: "No workspace folder available for search" };
  }
  const validatedPath = validateDirectoryPath(searchPath, context.workspaceFolders);
  const results = await searchInDirectory(validatedPath, query, filePattern);
  return { success: true, result: results };
}
async function searchInDirectory(dirPath, query, filePattern) {
  const results = [];
  const queryLower = query.toLowerCase();
  async function searchDir(currentPath) {
    const entries = await fs11.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") {
        continue;
      }
      const fullPath = path7.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await searchDir(fullPath);
      } else if (matchesPattern(entry.name, filePattern)) {
        try {
          const content = await fs11.readFile(fullPath, "utf-8");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(queryLower)) {
              results.push({
                file: fullPath,
                line: i + 1,
                content: lines[i].trim().substring(0, 200)
              });
              if (results.filter((r) => r.file === fullPath).length >= 5) {
                break;
              }
            }
          }
        } catch {
        }
      }
      if (results.length >= MAX_SEARCH_RESULTS) {
        return;
      }
    }
  }
  await searchDir(dirPath);
  return results;
}
function matchesPattern(filename, pattern) {
  if (pattern === "*") return true;
  const regex = new RegExp(
    "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$",
    "i"
  );
  return regex.test(filename);
}
async function executeSearchWeb(args) {
  const query = String(args.query || "");
  if (!query) {
    return { success: false, error: "Query is required" };
  }
  return {
    success: false,
    error: "Web search is not configured. Please set up SearxNG in settings.yaml"
  };
}
async function executeVectorSearch(args, context) {
  const query = String(args.query || "");
  const limit = typeof args.limit === "number" ? args.limit : 5;
  if (!query) {
    return { success: false, error: "Query is required" };
  }
  const conversationId = context.conversationId;
  const results = await searchRAG(query, limit, conversationId);
  if (results.length === 0) {
    return {
      success: true,
      result: "No results found. The RAG index may not be initialized or no documents matched your query."
    };
  }
  const formatted = results.map(
    (r, i) => `[${i + 1}] ${r.filePath} (lines ${r.startLine}-${r.endLine}, score: ${r.score.toFixed(2)})
${r.content}`
  ).join("\n\n");
  return { success: true, result: formatted };
}
async function executeDuckAi(args) {
  const query = String(args.query || "");
  if (!query) {
    return { success: false, error: "Query is required" };
  }
  return {
    success: false,
    error: "DuckDuckGo AI is not yet implemented"
  };
}
function executeGetOpenFiles(context) {
  return {
    success: true,
    result: context.openFiles
  };
}
function executeGetWorkspaceFolders(context) {
  return {
    success: true,
    result: context.workspaceFolders
  };
}
async function executeUpdateMemory(args) {
  const request = {
    scope: args.scope || "system",
    action: args.action || "add",
    section: String(args.section || ""),
    content: String(args.content || "")
  };
  if (!request.section) {
    return { success: false, error: "Section is required" };
  }
  return {
    success: true,
    result: {
      type: "memory_update_proposal",
      request
    }
  };
}
async function executeConsultAgent(agentType, args, context) {
  const task = String(args.task || "");
  const additionalContext = args.context ? String(args.context) : args.content ? String(args.content) : "";
  if (!task) {
    return { success: false, error: "Task description is required" };
  }
  if (!isInitialized()) {
    return {
      success: true,
      result: `[${agentType.toUpperCase()} AGENT SIMULATION]

Task: ${task}
${additionalContext ? `Context: ${additionalContext}
` : ""}
Note: Multi-agent system is not enabled. To enable specialist agents, add an "agents" section to your settings.yaml file.

For now, I'll help you directly with this ${agentType} task.`
    };
  }
  try {
    const agentTask = await routeUserMessage(
      `[From Orchestrator] ${task}${additionalContext ? `

Context: ${additionalContext}` : ""}`,
      {
        targetAgent: agentType,
        workspaceFolders: context.workspaceFolders,
        openFiles: context.openFiles
      }
    );
    if (!agentTask) {
      return { success: false, error: `Failed to create task for ${agentType} agent` };
    }
    const timeout = 6e4;
    const startTime = Date.now();
    while (agentTask.status !== "complete" && agentTask.status !== "failed") {
      if (Date.now() - startTime > timeout) {
        return {
          success: false,
          error: `${agentType} agent task timed out after ${timeout / 1e3} seconds`
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (agentTask.status === "failed") {
      return {
        success: false,
        error: `${agentType} agent failed: ${agentTask.error || "Unknown error"}`
      };
    }
    const result = agentTask.result;
    return {
      success: true,
      result: `[${agentType.toUpperCase()} AGENT RESPONSE]

${typeof result === "string" ? result : JSON.stringify(result, null, 2)}`
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to consult ${agentType} agent: ${String(error)}`
    };
  }
}
function executeConsultBoss(args) {
  const message = String(args.message || "");
  const messageType = args.type || "info";
  if (!message) {
    return { success: false, error: "Message is required" };
  }
  return {
    success: true,
    result: "Message shown to user",
    uiData: {
      type: "consult_boss",
      message,
      messageType
    }
  };
}
async function executeUpdateTasks(args, context) {
  if (!context.workspaceId || !context.conversationId) {
    return { success: false, error: "Missing workspaceId or conversationId in context" };
  }
  let taskList = await loadTaskList(context.workspaceId, context.conversationId);
  if (!taskList) {
    taskList = createTaskList(context.conversationId);
  }
  const warnings = [];
  const toAdd = args.add;
  if (toAdd && Array.isArray(toAdd)) {
    for (const task of toAdd) {
      if (task.description) {
        addTask(taskList, task.description, task.priority || 0);
      }
    }
  }
  const toComplete = args.complete;
  if (toComplete && Array.isArray(toComplete)) {
    const completedCount = completeTasks(taskList, toComplete);
    if (completedCount < toComplete.length) {
      const validIds = taskList.tasks.map((t) => t.id);
      const invalidIds = toComplete.filter((id) => !validIds.includes(id));
      if (invalidIds.length > 0) {
        warnings.push(`Could not complete: ${invalidIds.join(", ")} (not found). Valid IDs: ${validIds.join(", ")}`);
      }
    }
  }
  const toRemove = args.remove;
  if (toRemove && Array.isArray(toRemove)) {
    for (const taskId of toRemove) {
      const removed = removeTask(taskList, taskId);
      if (!removed) {
        const validIds = taskList.tasks.map((t) => t.id);
        warnings.push(`Could not remove "${taskId}" (not found). Valid IDs: ${validIds.join(", ")}`);
      }
    }
  }
  const toUpdate = args.update;
  if (toUpdate && Array.isArray(toUpdate)) {
    for (const update of toUpdate) {
      let found = false;
      if (update.status) {
        found = updateTaskStatus(taskList, update.id, update.status) || found;
      }
      if (update.description) {
        found = updateTaskDescription(taskList, update.id, update.description) || found;
      }
      if (!found) {
        const validIds = taskList.tasks.map((t) => t.id);
        warnings.push(`Could not update "${update.id}" (not found). Valid IDs: ${validIds.join(", ")}`);
      }
    }
  }
  console.log("[Markus] Saving task list:", taskList.tasks.length, "tasks");
  console.log("[Markus] Task descriptions:", taskList.tasks.map((t) => `[${t.status}] ${t.description}`));
  await saveTaskList(context.workspaceId, taskList);
  let result = formatTaskListForPrompt(taskList);
  if (warnings.length > 0) {
    result += "\n\n\u26A0\uFE0F Warnings:\n" + warnings.map((w) => `- ${w}`).join("\n");
  }
  const openCount = taskList.tasks.filter((t) => t.status !== "done").length;
  if (openCount > 10) {
    result += `

\u26A0\uFE0F Task list has ${openCount} open items \u2014 stop adding tasks and focus on completing existing ones.`;
  }
  return {
    success: true,
    result
  };
}
function executeAskUser(args) {
  const question = String(args.question || "");
  const options = args.options;
  const reason = args.reason ? String(args.reason) : void 0;
  if (!question) {
    return { success: false, error: "Question is required" };
  }
  if (!options || !Array.isArray(options) || options.length < 2) {
    return { success: false, error: "At least 2 options are required" };
  }
  if (options.length > 5) {
    return { success: false, error: "Maximum 5 options allowed" };
  }
  return {
    success: true,
    result: "WAITING_FOR_USER_INPUT",
    blocking: true,
    uiData: {
      type: "ask_user",
      question,
      options: [...options, "Other"],
      reason
    }
  };
}
function executeRequestApproval(args) {
  const summary = String(args.summary || "");
  const filesChanged = args.files_changed;
  if (!summary) {
    return { success: false, error: "Summary is required" };
  }
  return {
    success: true,
    result: "WAITING_FOR_APPROVAL",
    blocking: true,
    uiData: {
      type: "approval",
      summary,
      filesChanged: filesChanged || []
    }
  };
}
var ORCHESTRATOR_CONTROL_TOOL_NAMES = [
  "consult_boss",
  "update_tasks",
  "ask_user",
  "request_task_approval"
];
function buildOrchestratorTools(subAgents) {
  const controlTools = TOOL_DEFINITIONS.filter(
    (def) => ORCHESTRATOR_CONTROL_TOOL_NAMES.includes(def.name)
  );
  const agentTools = subAgents.map((agent) => ({
    name: `consult_${agent.type}_agent`,
    description: `Delegate a task to the ${agent.agentName} agent. ${agent.roleDefinition.substring(0, 200)}`,
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: `Task description for the ${agent.agentName} agent. Include ALL relevant context \u2014 the agent cannot see your conversation history.`
        },
        context: {
          type: "string",
          description: "Additional context about what you are working on"
        }
      },
      required: ["task"]
    }
  }));
  const definitions = [...controlTools, ...agentTools];
  const agentBySlug = /* @__PURE__ */ new Map();
  for (const agent of subAgents) {
    agentBySlug.set(String(agent.type), agent);
  }
  const orchestratorExecuteTool = async (name, args, ctx) => {
    if (ORCHESTRATOR_CONTROL_TOOL_NAMES.includes(name)) {
      return executeTool(name, args, ctx);
    }
    const agentMatch = name.match(/^consult_(.+)_agent$/);
    if (agentMatch) {
      const slug = agentMatch[1];
      const agent = agentBySlug.get(slug);
      if (!agent) {
        return { success: false, error: `Unknown agent: ${slug}` };
      }
      return executeSubAgentTask(agent, args, ctx);
    }
    return { success: false, error: `Unknown orchestrator tool: ${name}` };
  };
  return { definitions, executeTool: orchestratorExecuteTool };
}
async function executeSubAgentTask(agent, args, ctx) {
  const taskDescription = String(args.task || "");
  const additionalContext = args.context ? String(args.context) : "";
  if (!taskDescription) {
    return { success: false, error: "Task description is required" };
  }
  if (!agent.getStatus || agent.getStatus() === "idle") {
    try {
      agent.initialize();
    } catch {
    }
  }
  agent.setWorkspaceFolders(ctx.workspaceFolders);
  const agentTask = {
    id: v4_default(),
    description: taskDescription + (additionalContext ? `

Context: ${additionalContext}` : ""),
    agent: agent.type,
    priority: 1,
    status: "pending",
    context: {
      workspaceFolders: ctx.workspaceFolders,
      openFiles: ctx.openFiles
    },
    createdAt: Date.now()
  };
  try {
    await agent.processTask(agentTask);
    if (agentTask.status === "failed") {
      return {
        success: false,
        error: `${agent.agentName} agent failed: ${agentTask.error || "Unknown error"}`
      };
    }
    const result = agentTask.result;
    const resultText = typeof result === "string" ? result : result?.content || JSON.stringify(result, null, 2);
    return {
      success: true,
      result: `[${agent.agentName.toUpperCase()} AGENT RESPONSE]

${resultText}`
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to consult ${agent.agentName} agent: ${String(error)}`
    };
  }
}

// ../../electron/markus/thoughtLoop/types.ts
var DEFAULT_LOOP_CONFIG = {
  maxIterations: 30,
  maxNoToolRetries: 3
};

// ../../electron/markus/thoughtLoop/logManager.ts
import path8 from "path";
import fs12 from "fs/promises";
import { existsSync as existsSync8 } from "fs";
function getLogsDir(workspaceId) {
  return path8.join(getConfigDir(), "workspaces", workspaceId, "logs");
}
async function ensureLogsDir(workspaceId) {
  const dir = getLogsDir(workspaceId);
  await fs12.mkdir(dir, { recursive: true });
  return dir;
}
function getLogPath(workspaceId, conversationId) {
  return path8.join(getLogsDir(workspaceId), `${conversationId}.json`);
}
function createLog(workspaceId, mode = "planning") {
  const now = Date.now();
  return {
    id: v4_default(),
    workspaceId,
    title: "New Conversation",
    mode,
    userMessages: [],
    iterations: [],
    tasks: {
      tasks: [],
      updatedAt: now
    },
    metadata: {
      totalIterations: 0,
      condensationCount: 0
    },
    createdAt: now,
    updatedAt: now
  };
}
async function saveLog(log) {
  await ensureLogsDir(log.workspaceId);
  const filePath = getLogPath(log.workspaceId, log.id);
  log.updatedAt = Date.now();
  log.metadata.totalIterations = log.iterations.length;
  if (log.title === "New Conversation" && log.userMessages.length > 0) {
    const firstMessage = log.userMessages[0].content;
    log.title = firstMessage.length <= 50 ? firstMessage : firstMessage.substring(0, 47) + "...";
  }
  await fs12.writeFile(filePath, JSON.stringify(log, null, 2), "utf-8");
}
async function loadLog(workspaceId, conversationId) {
  const filePath = getLogPath(workspaceId, conversationId);
  if (!existsSync8(filePath)) {
    return null;
  }
  try {
    const content = await fs12.readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.error("[LogManager] Failed to load log:", error);
    return null;
  }
}
async function deleteLog(workspaceId, conversationId) {
  const filePath = getLogPath(workspaceId, conversationId);
  if (!existsSync8(filePath)) {
    return false;
  }
  try {
    await fs12.unlink(filePath);
    return true;
  } catch (error) {
    console.error("[LogManager] Failed to delete log:", error);
    return false;
  }
}
async function listLogs(workspaceId) {
  const dir = getLogsDir(workspaceId);
  if (!existsSync8(dir)) {
    return [];
  }
  try {
    const files = await fs12.readdir(dir);
    const logs = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const content = await fs12.readFile(path8.join(dir, file), "utf-8");
        const log = JSON.parse(content);
        logs.push({
          id: log.id,
          title: log.title,
          updatedAt: log.updatedAt,
          iterationCount: log.iterations.length
        });
      } catch {
      }
    }
    return logs.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (error) {
    console.error("[LogManager] Failed to list logs:", error);
    return [];
  }
}
function addUserMessage(log, content, inResponseTo) {
  const message = {
    id: v4_default(),
    content,
    timestamp: Date.now(),
    inResponseTo
  };
  log.userMessages.push(message);
  log.updatedAt = Date.now();
  return message;
}
function addIteration(log, iteration) {
  const fullIteration = {
    ...iteration,
    id: v4_default(),
    index: log.iterations.length
  };
  log.iterations.push(fullIteration);
  log.metadata.totalIterations = log.iterations.length;
  log.updatedAt = Date.now();
  return fullIteration;
}
function updateTasks(log, tasks) {
  log.tasks = tasks;
  log.updatedAt = Date.now();
}
function setError(log, error) {
  log.metadata.lastError = error;
  log.updatedAt = Date.now();
}
function setMode(log, mode) {
  log.mode = mode;
  log.updatedAt = Date.now();
}
function getConsultBossMessages(log) {
  const messages = [];
  for (const iteration of log.iterations) {
    for (const toolCall of iteration.toolCalls) {
      if (toolCall.name === "consult_boss" && toolCall.status === "complete") {
        const args = toolCall.arguments;
        if (args.message) {
          messages.push({
            message: args.message,
            type: args.type || "info",
            iterationIndex: iteration.index,
            timestamp: toolCall.completedAt || toolCall.startedAt
          });
        }
      }
    }
  }
  return messages;
}
function getFileReadCache(log) {
  const cache = /* @__PURE__ */ new Map();
  for (const iteration of log.iterations) {
    for (const toolCall of iteration.toolCalls) {
      if (toolCall.name === "read_file" && toolCall.cachedContent) {
        const args = toolCall.arguments;
        if (args.path) {
          cache.set(args.path, {
            content: toolCall.cachedContent,
            readAtIteration: iteration.index
          });
        }
      }
    }
  }
  return cache;
}
function getRecentIterations(log, count = 5) {
  return log.iterations.slice(-count);
}
function summarizeToolCall(tc) {
  const args = tc.arguments || {};
  const keyArg = args.path || args.query || args.message?.toString().substring(0, 50) || args.description;
  const argStr = keyArg ? `(${String(keyArg).substring(0, 80)})` : "";
  const status = tc.status === "error" ? `FAILED: ${tc.result?.error || "unknown"}` : "";
  return status ? `${tc.name}${argStr} [${status}]` : `${tc.name}${argStr}`;
}
function summarizeIteration(iteration) {
  const toolSummaries = iteration.toolCalls.map(summarizeToolCall);
  const endType = iteration.endState.type;
  const endInfo = endType === "blocking_tool" ? ` (blocked by ${iteration.endState.toolName})` : endType === "error" ? ` (error: ${iteration.endState.message})` : "";
  return `Iteration ${iteration.index}: ${toolSummaries.join(", ") || "no tools"}${endInfo}`;
}
function estimateTokens3(log) {
  let chars = 0;
  for (const msg of log.userMessages) {
    chars += msg.content.length;
  }
  for (const iteration of log.iterations) {
    chars += iteration.response.rawContent.length;
    for (const tc of iteration.toolCalls) {
      if (tc.cachedContent) {
        chars += tc.cachedContent.length;
      }
    }
  }
  return Math.ceil(chars / 4);
}
function getBlockingToolCall(log) {
  if (log.iterations.length === 0) return null;
  const lastIteration = log.iterations[log.iterations.length - 1];
  if (lastIteration.endState.type !== "blocking_tool") return null;
  const blockingId = lastIteration.endState.toolCallId;
  return lastIteration.toolCalls.find((tc) => tc.id === blockingId) || null;
}

// ../../electron/markus/memory.ts
import path9 from "path";
import fs13 from "fs/promises";
import { existsSync as existsSync9 } from "fs";
function getSystemMemoryPath() {
  return path9.join(getConfigDir(), "memory.md");
}
function getProjectMemoryPath(workspaceFolder) {
  return path9.join(workspaceFolder, ".markus", "memory.md");
}
function getSystemInstructionsPath() {
  return path9.join(getConfigDir(), "instructions.md");
}
function getProjectInstructionsPath(workspaceFolder) {
  return path9.join(workspaceFolder, ".markus", "instructions.md");
}
async function readMemoryFile(filePath) {
  if (!existsSync9(filePath)) {
    return "";
  }
  try {
    return await fs13.readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}
async function getAllContext(workspaceFolders) {
  const systemMemory = await readMemoryFile(getSystemMemoryPath());
  const systemInstructions = await readMemoryFile(getSystemInstructionsPath());
  let projectMemory = "";
  let projectInstructions = "";
  for (const folder of workspaceFolders) {
    const memory = await readMemoryFile(getProjectMemoryPath(folder));
    const instructions = await readMemoryFile(getProjectInstructionsPath(folder));
    if (memory) {
      projectMemory += `
### ${path9.basename(folder)}

${memory}
`;
    }
    if (instructions) {
      projectInstructions += `
### ${path9.basename(folder)}

${instructions}
`;
    }
  }
  return {
    systemMemory,
    systemInstructions,
    projectMemory: projectMemory.trim(),
    projectInstructions: projectInstructions.trim()
  };
}

// ../../electron/markus/thoughtLoop/contextBuilder.ts
var CHARS_PER_TOKEN = 4;
var MAX_FILE_CHARS_EXECUTION = 1e4;
var RECENT_ITERATIONS_COUNT = 5;
async function buildSystemPrompt(workspaceFolders, mode, tasks, agentDefinitions, globalAgentInstructions, toolDefinitions) {
  const sources = [];
  const context = await getAllContext(workspaceFolders);
  const toolSchema = generateToolSchema(toolDefinitions ?? TOOL_DEFINITIONS);
  let systemPrompt = `You are Markus, an AI assistant integrated into a markdown editor.

## CRITICAL RULES (MUST FOLLOW)

1. **You MUST call a tool in every response** - NO EXCEPTIONS
2. **The user (boss) can ONLY see content inside tool calls**
3. To show anything to the user, use the \`consult_boss\` tool
4. **Any text outside tool calls is INVISIBLE to the user**
5. If you're not sure what to do, call \`update_tasks\` to review progress
6. When all tasks are done, call \`request_task_approval\`
7. If you need user input, call \`ask_user\` with clickable options

## REMEMBER: Text outside tool calls = invisible to boss!

## Available Tools (in priority order)

1. **consult_boss** - Show messages to user (ONLY way to communicate!)
2. **read_file, edit_file, create_file, list_directory, search_files** - Do the actual work
3. **update_tasks** - Track progress (NOT for planning \u2014 see Task Rules below)
4. **ask_user** - Ask user with predefined options (PAUSES for input)
5. **request_task_approval** - Submit completed work for approval (PAUSES)
6. **consult_*_agent** - Get specialist input (non-blocking)

## Task Rules

- Keep your task list SHORT \u2014 aim for 3-7 tasks max. Each task should represent a meaningful deliverable, not a micro-step.
- Do NOT decompose tasks into sub-tasks. If a task is complex, just start working on it.
- Do NOT create new tasks for work you've already done or are about to do in this iteration.
- Spend most iterations doing actual work (reading/writing files), not reorganizing tasks.
- When all tasks are done, call request_task_approval immediately.

## Current Mode: ${mode.toUpperCase()}

## Workspace Folders

These are the project directories you are working in:
${workspaceFolders.map((f) => `- \`${f}\``).join("\n")}

All file paths MUST be absolute and within these folders. Use these paths directly \u2014 do NOT use relative paths like "." or "..".

`;
  sources.push({
    type: "system_prompt",
    charCount: systemPrompt.length
  });
  const modeInstructions = mode === "planning" ? `In PLANNING mode:
- Focus on understanding the task and gathering information
- Use read-only tools to analyze files and understand context
- Create a task list with update_tasks
- When ready to execute, tell the user via consult_boss
` : `In EXECUTION mode:
- You have permission to create and edit files
- Work through your task list systematically
- Use update_tasks to mark progress
- When done, call request_task_approval
`;
  systemPrompt += modeInstructions + "\n";
  sources.push({
    type: "mode_instructions",
    charCount: modeInstructions.length
  });
  if (agentDefinitions && agentDefinitions.length > 0) {
    let agentSection = `## Your Specialist Agents

You have the following agents available for delegation:

`;
    for (const agent of agentDefinitions) {
      agentSection += `- **${agent.name}** (\`consult_${agent.slug}_agent\`): ${agent.description}
`;
      if (agent.whenToUse) {
        agentSection += `  _When to use:_ ${agent.whenToUse}
`;
      }
    }
    agentSection += `
**IMPORTANT - Agent Context Rules:**
1. Agents can ONLY see the task description you give them + the files in the workspace
2. Agents CANNOT see your conversation history with the user
3. You MUST include ALL relevant context in your task description
4. Be explicit and detailed - agents work best with clear, complete context

`;
    systemPrompt += agentSection;
  } else {
    systemPrompt += `## Your Specialist Agents

You have a team of specialist agents you can delegate tasks to:

- **Research Agent** (consult_research_agent): Deep file exploration and analysis
- **Critique Agent** (consult_critique_agent): Quality review and validation
- **Style Agent** (consult_style_agent): Formatting and writing polish
- **Creative Agent** (consult_creative_agent): Ideas and brainstorming

**IMPORTANT - Agent Context Rules:**
1. Agents can ONLY see the task description you give them + the files in the workspace
2. Agents CANNOT see your conversation history with the user
3. You MUST include ALL relevant context in your task description
4. Be explicit and detailed - agents work best with clear, complete context

`;
  }
  if (globalAgentInstructions) {
    const globalSection = `## Global Agent Instructions

${globalAgentInstructions}

`;
    systemPrompt += globalSection;
    sources.push({
      type: "memory",
      reference: "global_agent_instructions",
      charCount: globalSection.length
    });
  }
  systemPrompt += toolSchema + "\n\n";
  if (tasks.tasks.length > 0) {
    const taskListPrompt = formatTaskListForPrompt({
      conversationId: "",
      tasks: tasks.tasks,
      createdAt: tasks.updatedAt,
      updatedAt: tasks.updatedAt
    });
    systemPrompt += taskListPrompt + "\n\n";
    sources.push({
      type: "task_list",
      charCount: taskListPrompt.length
    });
  } else {
    const noTasksPrompt = `## Tasks

No tasks defined yet. When you receive a request:
1. Use update_tasks to create 3-7 high-level tasks (NOT sub-tasks)
2. Immediately start working on the first task
3. Use consult_boss to communicate progress
4. When done, call request_task_approval

`;
    systemPrompt += noTasksPrompt;
    sources.push({
      type: "task_list",
      charCount: noTasksPrompt.length
    });
  }
  if (context.systemInstructions) {
    const section = `## Global Instructions

${context.systemInstructions}

`;
    systemPrompt += section;
    sources.push({
      type: "memory",
      reference: "system_instructions",
      charCount: section.length
    });
  }
  if (context.projectInstructions) {
    const section = `## Project Instructions

${context.projectInstructions}

`;
    systemPrompt += section;
    sources.push({
      type: "memory",
      reference: "project_instructions",
      charCount: section.length
    });
  }
  if (context.systemMemory) {
    const section = `## Memory (Global)

${context.systemMemory}

`;
    systemPrompt += section;
    sources.push({
      type: "memory",
      reference: "system_memory",
      charCount: section.length
    });
  }
  if (context.projectMemory) {
    const section = `## Memory (Project)

${context.projectMemory}

`;
    systemPrompt += section;
    sources.push({
      type: "memory",
      reference: "project_memory",
      charCount: section.length
    });
  }
  return { prompt: systemPrompt, sources };
}
async function buildContext(log, workspaceFolders, options) {
  const sources = [];
  const messages = [];
  const { prompt: systemPrompt, sources: promptSources } = await buildSystemPrompt(
    workspaceFolders,
    options.mode,
    options.tasks,
    options.agentDefinitions,
    void 0,
    // globalAgentInstructions
    options.toolDefinitions
  );
  sources.push(...promptSources);
  const userMessagesContent = log.userMessages.map((msg) => {
    if (msg.inResponseTo) {
      return `[Response to: "${msg.inResponseTo.question}"]
${msg.content}`;
    }
    return msg.content;
  }).join("\n\n---\n\n");
  if (userMessagesContent) {
    messages.push({
      role: "user",
      content: userMessagesContent,
      source: "user_messages"
    });
    sources.push({
      type: "user_message",
      charCount: userMessagesContent.length
    });
  }
  const consultBossMessages = getConsultBossMessages(log);
  if (consultBossMessages.length > 0) {
    const consultContent = consultBossMessages.map((m) => `[${m.type.toUpperCase()}] ${m.message}`).join("\n\n");
    messages.push({
      role: "assistant",
      content: `[Previous messages to user]:

${consultContent}`,
      source: "consult_boss"
    });
    sources.push({
      type: "consult_boss",
      charCount: consultContent.length
    });
  }
  const fileCache = getFileReadCache(log);
  if (fileCache.size > 0) {
    let fileContent = "[Files read]:\n\n";
    for (const [path11, cached] of fileCache) {
      let content = cached.content;
      if (options.mode === "execution" && content.length > MAX_FILE_CHARS_EXECUTION) {
        content = content.substring(0, MAX_FILE_CHARS_EXECUTION) + "\n... (truncated)";
        sources.push({
          type: "file_read",
          reference: path11,
          charCount: MAX_FILE_CHARS_EXECUTION,
          truncated: true
        });
      } else {
        sources.push({
          type: "file_read",
          reference: path11,
          charCount: content.length
        });
      }
      fileContent += `--- ${path11} ---
${content}

`;
    }
    messages.push({
      role: "assistant",
      content: fileContent,
      source: "file_cache"
    });
  }
  if (log.iterations.length > 0) {
    const recentIterations = getRecentIterations(log, RECENT_ITERATIONS_COUNT);
    const summaries = recentIterations.map(summarizeIteration).join("\n");
    if (summaries) {
      messages.push({
        role: "assistant",
        content: `[Recent actions]:
${summaries}`,
        source: "iteration_summaries"
      });
      sources.push({
        type: "iteration_summary",
        charCount: summaries.length
      });
    }
  }
  if (log.iterations.length > 0) {
    const lastIteration = log.iterations[log.iterations.length - 1];
    if (lastIteration.endState.type === "continue") {
      const toolResultParts = [];
      for (const tc of lastIteration.toolCalls) {
        if (tc.status === "complete" && tc.result) {
          const resultStr = typeof tc.result?.data === "string" ? tc.result.data : JSON.stringify(tc.result?.data);
          toolResultParts.push(`Tool "${tc.name}" (success):
${resultStr}`);
        } else if (tc.status === "error" && tc.result?.error) {
          toolResultParts.push(`Tool "${tc.name}" (ERROR):
${tc.result.error}`);
        }
      }
      const toolResults = toolResultParts.join("\n\n---\n\n");
      if (toolResults) {
        messages.push({
          role: "user",
          content: `[Tool Results]

${toolResults}

Continue working. Remember to use tools - text outside tools is invisible.`,
          source: "tool_results"
        });
        sources.push({
          type: "tool_result",
          charCount: toolResults.length
        });
      }
    }
  }
  const continuationPrompt = options.mode === "planning" ? "Continue analyzing. Use tools to gather information and create your task list." : "Continue executing. Mark tasks complete as you finish them.";
  messages.push({
    role: "user",
    content: continuationPrompt,
    source: "continuation"
  });
  const totalChars = systemPrompt.length + messages.reduce((acc, m) => acc + m.content.length, 0);
  const estimatedTokens = Math.ceil(totalChars / CHARS_PER_TOKEN);
  return {
    messages,
    systemPrompt,
    sources,
    estimatedTokens
  };
}
async function buildInitialContext(userMessage, workspaceFolders, mode, tasks, options) {
  const sources = [];
  const { prompt: systemPrompt, sources: promptSources } = await buildSystemPrompt(
    workspaceFolders,
    mode,
    tasks,
    options?.agentDefinitions,
    void 0,
    // globalAgentInstructions
    options?.toolDefinitions
  );
  sources.push(...promptSources);
  const messages = [
    {
      role: "user",
      content: userMessage,
      source: "initial_message"
    }
  ];
  sources.push({
    type: "user_message",
    charCount: userMessage.length
  });
  const totalChars = systemPrompt.length + userMessage.length;
  const estimatedTokens = Math.ceil(totalChars / CHARS_PER_TOKEN);
  return {
    messages,
    systemPrompt,
    sources,
    estimatedTokens
  };
}
function contextToLLMMessages(context) {
  const messages = [
    { role: "system", content: context.systemPrompt }
  ];
  for (const msg of context.messages) {
    messages.push({
      role: msg.role,
      content: msg.content
    });
  }
  return messages;
}
function createRequestContext(context) {
  return {
    systemPrompt: context.systemPrompt,
    messages: context.messages,
    contextSources: context.sources,
    estimatedTokens: context.estimatedTokens
  };
}

// ../../electron/markus/thoughtLoop/loopController.ts
function stripReasoningContent(content) {
  const reasoningPatterns = [
    /^The user (is|has|wants|seems)/i,
    /^Let me /i,
    /^I (should|need to|will|don't need|can|cannot)/i,
    /^Since /i,
    /^First,? I/i,
    /^Now I/i,
    /^Looking at/i,
    /^Based on/i,
    /^Analyzing/i
  ];
  const hasReasoningStart = reasoningPatterns.some((pattern) => pattern.test(content.trim()));
  if (!hasReasoningStart) {
    return content;
  }
  const responseStartPatterns = [
    /(?:^|\n\n)(Hello[!,]?\s)/im,
    /(?:^|\n\n)(Hi[!,]?\s)/im,
    /(?:^|\n\n)(Hey[!,]?\s)/im,
    /(?:^|\n\n)(#{1,3}\s+\w)/m,
    /(?:^|\n\n)(I'd be happy to)/im,
    /(?:^|\n\n)(I can help)/im,
    /(?:^|\n\n)(Sure[!,]?\s)/im,
    /(?:^|\n\n)(Here's )/im,
    /(?:^|\n\n)(Here are )/im
  ];
  for (const pattern of responseStartPatterns) {
    const match = content.match(pattern);
    if (match && match.index !== void 0) {
      const responseStart = match.index + (match[0].startsWith("\n") ? 2 : 0);
      const extracted = content.slice(responseStart).trim();
      if (extracted.length > 50) {
        return extracted;
      }
    }
  }
  return content;
}
function parseContentForToolCalls(content) {
  const toolCalls = [];
  let textContent = content;
  const jsonBlockRegex = /```(?:json)?\s*\n?\s*(\{[\s\S]*?\})\s*\n?```/g;
  let match;
  while ((match = jsonBlockRegex.exec(content)) !== null) {
    try {
      const jsonContent = match[1].trim();
      const parsed = JSON.parse(jsonContent);
      if (parsed.tool && typeof parsed.tool === "string") {
        toolCalls.push({
          id: v4_default(),
          name: parsed.tool,
          arguments: parsed.arguments || {}
        });
        textContent = textContent.replace(match[0], "").trim();
      }
    } catch {
    }
  }
  const extractJsonObjects = (text) => {
    const objects = [];
    let i = 0;
    while (i < text.length) {
      if (text[i] === "{") {
        let depth = 1;
        const start = i;
        i++;
        while (i < text.length && depth > 0) {
          if (text[i] === "{") depth++;
          else if (text[i] === "}") depth--;
          i++;
        }
        if (depth === 0) {
          objects.push({ json: text.substring(start, i), start, end: i });
        }
      } else {
        i++;
      }
    }
    return objects;
  };
  const jsonObjects = extractJsonObjects(textContent);
  const indicesToRemove = [];
  for (const { json, start, end } of jsonObjects) {
    try {
      const parsed = JSON.parse(json);
      if (parsed.tool && typeof parsed.tool === "string") {
        toolCalls.push({
          id: v4_default(),
          name: parsed.tool,
          arguments: parsed.arguments || {}
        });
        indicesToRemove.push({ start, end });
      }
    } catch {
    }
  }
  indicesToRemove.sort((a, b) => b.start - a.start);
  for (const { start, end } of indicesToRemove) {
    textContent = textContent.substring(0, start) + textContent.substring(end);
  }
  textContent = textContent.trim();
  return { textContent, toolCalls };
}
function isSafeTool(toolName) {
  const safeTools = [
    "read_file",
    "list_directory",
    "search_files",
    "get_open_files",
    "get_workspace_folders",
    "consult_research_agent",
    "consult_critique_agent",
    "consult_style_agent",
    "consult_creative_agent"
  ];
  if (safeTools.includes(toolName)) return true;
  if (toolName.startsWith("consult_") && toolName.endsWith("_agent")) return true;
  return false;
}
function isTransientError(error) {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("terminated") || msg.includes("econnreset") || msg.includes("etimedout") || msg.includes("econnrefused") || msg.includes("stream timeout") || msg.includes("network") || msg.includes("fetch failed") || msg.includes("socket hang up")) {
      return true;
    }
    const cause = error.cause;
    if (cause instanceof Error) {
      const causeMsg = cause.message.toLowerCase();
      if (causeMsg.includes("econnreset") || causeMsg.includes("etimedout") || causeMsg.includes("econnrefused")) {
        return true;
      }
    }
  }
  return false;
}
var MAX_STREAM_RETRIES = 3;
function isWriteTool(toolName) {
  return ["create_file", "edit_file", "create_directory", "delete_file"].includes(toolName);
}
function isThoughtLoopTool(toolName) {
  return ["consult_boss", "update_tasks", "ask_user", "request_task_approval"].includes(toolName);
}
function isBlockingTool(toolName) {
  return ["ask_user", "request_task_approval"].includes(toolName);
}
var LoopController = class {
  constructor(options) {
    this.options = options;
  }
  state = "idle";
  config = DEFAULT_LOOP_CONFIG;
  noToolRetries = 0;
  consecutiveAllErrorIterations = 0;
  previousResponses = [];
  // Track tool call signatures to detect spinning (same tools called repeatedly)
  previousToolSignatures = [];
  /**
   * Runs the thought loop until a stop condition is met.
   * Returns the stop condition that ended the loop.
   */
  async run() {
    const {
      log,
      settings,
      workspaceFolders,
      workspaceId,
      transport,
      getOpenFiles,
      onEvent,
      abortSignal
    } = this.options;
    this.state = "thinking";
    let iteration = 0;
    const client = createLLMClient(settings.llm);
    while (iteration < this.config.maxIterations) {
      iteration++;
      console.log(`[LoopController] Iteration ${iteration}`);
      onEvent({ type: "iteration_started", iterationIndex: iteration - 1 });
      if (abortSignal?.aborted) {
        return {
          stopCondition: "user_cancelled",
          waitingForInput: false
        };
      }
      let taskList = await loadTaskList(workspaceId, log.id);
      if (!taskList) {
        taskList = createTaskList(log.id);
      }
      const contextCustomOpts = {
        toolDefinitions: this.options.toolDefinitions,
        agentDefinitions: this.options.agentDefinitions
      };
      const context = log.iterations.length === 0 && log.userMessages.length === 1 ? await buildInitialContext(
        log.userMessages[0].content,
        workspaceFolders,
        log.mode,
        { tasks: taskList.tasks, updatedAt: taskList.updatedAt },
        contextCustomOpts
      ) : await buildContext(log, workspaceFolders, {
        mode: log.mode,
        tasks: { tasks: taskList.tasks, updatedAt: taskList.updatedAt },
        ...contextCustomOpts
      });
      const llmMessages = contextToLLMMessages(context);
      const startedAt = Date.now();
      let fullContent = "";
      let streamFailed = false;
      for (let streamAttempt = 0; streamAttempt <= MAX_STREAM_RETRIES; streamAttempt++) {
        try {
          fullContent = "";
          for await (const chunk of client.chatStream(
            llmMessages,
            this.options.toolDefinitions ?? TOOL_DEFINITIONS,
            abortSignal
          )) {
            if (chunk.type === "content" && chunk.content) {
              fullContent += chunk.content;
              onEvent({ type: "llm_streaming", chunk: chunk.content });
            }
          }
          break;
        } catch (error) {
          if (abortSignal?.aborted) {
            return { stopCondition: "user_cancelled", waitingForInput: false };
          }
          if (streamAttempt < MAX_STREAM_RETRIES && isTransientError(error)) {
            const backoffMs = 1e3 * Math.pow(2, streamAttempt);
            console.warn(`[LoopController] Stream error (retry ${streamAttempt + 1}/${MAX_STREAM_RETRIES} in ${backoffMs}ms):`, error.message);
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
            continue;
          }
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error(`[LoopController] Unrecoverable stream error after ${streamAttempt} retries: ${errorMsg}`);
          const errorResponseData = {
            rawContent: fullContent,
            strippedContent: fullContent,
            parsedToolCalls: [],
            hasToolCalls: false,
            model: settings.llm.model
          };
          const iterationData2 = this.createIteration(
            iteration - 1,
            log.mode,
            context,
            errorResponseData,
            [],
            startedAt,
            Date.now(),
            { type: "error", message: `Connection lost: ${errorMsg}` }
          );
          addIteration(log, iterationData2);
          await saveLog(log);
          onEvent({
            type: "error",
            message: "Connection to LLM was lost. Your progress has been saved \u2014 send another message to continue."
          });
          streamFailed = true;
          break;
        }
      }
      if (streamFailed) {
        return { stopCondition: "error", waitingForInput: false };
      }
      const llmCompletedAt = Date.now();
      const { textContent, toolCalls } = parseContentForToolCalls(fullContent);
      const strippedContent = stripReasoningContent(textContent);
      const responseData = {
        rawContent: fullContent,
        strippedContent,
        parsedToolCalls: toolCalls,
        hasToolCalls: toolCalls.length > 0,
        model: settings.llm.model
      };
      onEvent({ type: "llm_complete", response: responseData });
      const normalizedResponse = strippedContent.toLowerCase().trim().substring(0, 500);
      const isTextRepetition = normalizedResponse.length > 0 && this.previousResponses.some(
        (prev) => prev.toLowerCase().trim().substring(0, 500) === normalizedResponse
      );
      const toolSignature = toolCalls.map((tc) => tc.name).sort().join(",");
      const recentSignatures = this.previousToolSignatures.slice(-3);
      const isToolSpinning = toolSignature.length > 0 && recentSignatures.length >= 2 && recentSignatures.every((sig) => sig === toolSignature);
      if (isTextRepetition || isToolSpinning) {
        const reason = isTextRepetition ? "text repetition" : "tool spinning";
        console.log(`[LoopController] Detected ${reason} (tools: [${toolSignature}])`);
        const iterationData2 = this.createIteration(
          iteration - 1,
          log.mode,
          context,
          responseData,
          [],
          startedAt,
          llmCompletedAt,
          { type: "repetition_detected" }
        );
        addIteration(log, iterationData2);
        await saveLog(log);
        return { stopCondition: "repetition_detected", waitingForInput: false };
      }
      this.previousResponses.push(strippedContent);
      this.previousToolSignatures.push(toolSignature);
      if (toolCalls.length === 0) {
        this.noToolRetries++;
        console.log(`[LoopController] No tool calls (retry ${this.noToolRetries}/${this.config.maxNoToolRetries})`);
        if (this.noToolRetries >= this.config.maxNoToolRetries) {
          const iterationData2 = this.createIteration(
            iteration - 1,
            log.mode,
            context,
            responseData,
            [],
            startedAt,
            llmCompletedAt,
            { type: "max_no_tool_retries", retryCount: this.noToolRetries }
          );
          addIteration(log, iterationData2);
          await saveLog(log);
          return { stopCondition: "max_no_tool_retries", waitingForInput: false };
        }
        addUserMessage(
          log,
          "[System] You MUST call a tool in every response. Use update_tasks to track progress, consult_boss to show messages, or other tools to do work. Text outside tool calls is invisible to the user."
        );
        onEvent({ type: "llm_streaming", chunk: "" });
        continue;
      }
      this.noToolRetries = 0;
      this.state = "executing";
      const toolCallLogs = [];
      let endState = { type: "continue" };
      for (const toolCallData of toolCalls) {
        const toolCallLog = {
          id: toolCallData.id,
          name: toolCallData.name,
          arguments: toolCallData.arguments,
          status: "pending",
          startedAt: Date.now(),
          blocking: isBlockingTool(toolCallData.name)
        };
        toolCallLogs.push(toolCallLog);
        onEvent({ type: "tool_started", toolCall: toolCallLog });
        if (this.options.toolDefinitions) {
          const knownToolNames = new Set(this.options.toolDefinitions.map((t) => t.name));
          if (!knownToolNames.has(toolCallData.name)) {
            toolCallLog.status = "error";
            toolCallLog.completedAt = Date.now();
            toolCallLog.result = {
              success: false,
              error: `Unknown tool: "${toolCallData.name}". Available tools: ${Array.from(knownToolNames).join(", ")}`
            };
            const toolResult = {
              success: false,
              error: toolCallLog.result.error
            };
            onEvent({ type: "tool_complete", toolCallId: toolCallLog.id, result: toolResult });
            transport.sendToolComplete(log.id, toolCallLog.id, toolResult);
            continue;
          }
        }
        let shouldExecute = this.options.yoloMode || isThoughtLoopTool(toolCallData.name) || isSafeTool(toolCallData.name);
        if (!shouldExecute) {
          transport.sendToolStarted(log.id, toolCallLog);
          try {
            shouldExecute = await transport.waitForToolApproval(log.id, toolCallLog.id);
          } catch (approvalError) {
            console.warn(`[LoopController] Tool approval failed for ${toolCallData.name}:`, approvalError.message);
            shouldExecute = false;
          }
        }
        if (shouldExecute) {
          toolCallLog.status = "executing";
          const toolContext = {
            workspaceFolders,
            openFiles: getOpenFiles(),
            mainWindow: null,
            workspaceId,
            conversationId: log.id
          };
          try {
            const executeToolFn = this.options.executeToolFn ?? executeTool;
            const result = await executeToolFn(toolCallData.name, toolCallData.arguments, toolContext);
            toolCallLog.status = result.success ? "complete" : "error";
            toolCallLog.completedAt = Date.now();
            toolCallLog.result = {
              success: result.success,
              data: result.result,
              error: result.error
            };
            if (toolCallData.name === "read_file" && result.success && typeof result.result === "string") {
              toolCallLog.cachedContent = result.result;
            }
            if (log.mode === "planning" && isWriteTool(toolCallData.name) && result.success) {
              log.mode = "execution";
              console.log(`[LoopController] Auto-switched to execution mode (triggered by ${toolCallData.name})`);
            }
            if (result.blocking && result.uiData) {
              toolCallLog.blocking = true;
              toolCallLog.uiData = result.uiData;
              transport.sendBlocking(log.id, toolCallLog.id, result.uiData);
              endState = {
                type: "blocking_tool",
                toolName: toolCallData.name,
                toolCallId: toolCallLog.id
              };
            }
            const toolResult = {
              success: result.success,
              data: result.result,
              error: result.error
            };
            onEvent({ type: "tool_complete", toolCallId: toolCallLog.id, result: toolResult });
            transport.sendToolComplete(log.id, toolCallLog.id, toolResult);
            if (result.openFile) {
              transport.sendOpenFile(result.openFile);
            }
            if (endState.type === "blocking_tool") {
              break;
            }
          } catch (error) {
            toolCallLog.status = "error";
            toolCallLog.completedAt = Date.now();
            toolCallLog.result = {
              success: false,
              error: String(error)
            };
          }
        } else {
          toolCallLog.status = "rejected";
          toolCallLog.completedAt = Date.now();
          toolCallLog.result = {
            success: false,
            error: "Tool call was rejected by user"
          };
        }
      }
      const updatedTaskList = await loadTaskList(workspaceId, log.id);
      if (updatedTaskList) {
        updateTasks(log, {
          tasks: updatedTaskList.tasks,
          updatedAt: updatedTaskList.updatedAt
        });
        transport.sendTasksUpdated(log.id, updatedTaskList.tasks);
      }
      if (toolCallLogs.every((tc) => tc.status === "rejected")) {
        endState = { type: "all_rejected" };
      }
      if (toolCallLogs.length > 0 && toolCallLogs.every((tc) => tc.status === "error")) {
        this.consecutiveAllErrorIterations++;
        console.log(`[LoopController] All tools errored (${this.consecutiveAllErrorIterations}/3 consecutive)`);
        if (this.consecutiveAllErrorIterations >= 3) {
          endState = { type: "error", message: "Stopped: model repeatedly called invalid tools" };
        }
      } else {
        this.consecutiveAllErrorIterations = 0;
      }
      const iterationData = this.createIteration(
        iteration - 1,
        log.mode,
        context,
        responseData,
        toolCallLogs,
        startedAt,
        llmCompletedAt,
        endState
      );
      addIteration(log, iterationData);
      await saveLog(log);
      onEvent({ type: "iteration_complete", iteration: { ...iterationData, id: v4_default(), index: iteration - 1 } });
      if (endState.type === "blocking_tool") {
        const blockingToolCall = toolCallLogs.find((tc) => tc.id === endState.toolCallId);
        onEvent({
          type: "loop_blocked",
          reason: `Waiting for ${endState.toolName}`,
          uiData: blockingToolCall?.uiData
        });
        return {
          stopCondition: "blocking_tool",
          waitingForInput: true,
          blockingToolCall
        };
      }
      if (endState.type === "all_rejected") {
        return { stopCondition: "all_rejected", waitingForInput: false };
      }
      if (endState.type === "error") {
        return { stopCondition: "error", waitingForInput: false };
      }
      this.state = "thinking";
      onEvent({ type: "llm_streaming", chunk: "" });
    }
    return { stopCondition: "max_iterations", waitingForInput: false };
  }
  /**
   * Creates an iteration record for logging.
   */
  createIteration(_index, mode, context, response, toolCalls, startedAt, llmCompletedAt, endState) {
    return {
      mode,
      request: createRequestContext(context),
      response,
      toolCalls,
      timing: {
        startedAt,
        llmCompletedAt,
        toolsCompletedAt: toolCalls.length > 0 ? Date.now() : void 0,
        endedAt: Date.now()
      },
      endState
    };
  }
};
async function runThoughtLoop(options) {
  const controller = new LoopController(options);
  return controller.run();
}

// ../../electron/markus/thoughtLoop/migrator.ts
function isOldFormat(data) {
  if (!data || typeof data !== "object") return false;
  const obj = data;
  return Array.isArray(obj.messages) && !Array.isArray(obj.iterations);
}
function isNewFormat(data) {
  if (!data || typeof data !== "object") return false;
  const obj = data;
  return Array.isArray(obj.iterations) && Array.isArray(obj.userMessages);
}
function migrateConversation(old) {
  const now = Date.now();
  const userMessages = [];
  const iterations = [];
  const toolResultMessages = /* @__PURE__ */ new Set();
  const systemReminderMessages = /* @__PURE__ */ new Set();
  for (const msg of old.messages) {
    if (msg.role === "user") {
      if (msg.content.startsWith("[Tool Results]")) {
        toolResultMessages.add(msg.id);
      } else if (msg.content.startsWith("[System]")) {
        systemReminderMessages.add(msg.id);
      }
    }
  }
  let currentIterationMessages = [];
  let iterationIndex = 0;
  for (const msg of old.messages) {
    if (msg.role === "user") {
      if (toolResultMessages.has(msg.id) || systemReminderMessages.has(msg.id)) {
        continue;
      }
      const isResponse = msg.content.startsWith("[User Response]");
      userMessages.push({
        id: msg.id,
        content: isResponse ? msg.content.replace("[User Response] ", "") : msg.content,
        timestamp: msg.timestamp,
        inResponseTo: isResponse ? { question: "Previous ask_user question" } : void 0
      });
    } else if (msg.role === "assistant") {
      currentIterationMessages.push(msg);
      if (msg.status === "complete" || msg.toolCalls && msg.toolCalls.length > 0) {
        const iteration = convertToIteration(msg, iterationIndex);
        if (iteration) {
          iterations.push(iteration);
          iterationIndex++;
        }
        currentIterationMessages = [];
      }
    }
  }
  const lastAssistant = old.messages.filter((m) => m.role === "assistant").pop();
  const mode = lastAssistant?.isPlan ? "planning" : "execution";
  return {
    id: old.id,
    workspaceId: old.filebarId,
    title: old.title,
    mode,
    userMessages,
    iterations,
    tasks: {
      tasks: [],
      updatedAt: now
    },
    metadata: {
      totalIterations: iterations.length,
      condensationCount: 0
    },
    createdAt: old.createdAt,
    updatedAt: old.updatedAt
  };
}
function convertToIteration(msg, index) {
  if (!msg.content.trim() && (!msg.toolCalls || msg.toolCalls.length === 0)) {
    return null;
  }
  const toolCalls = (msg.toolCalls || []).map((tc) => convertToolCall(tc));
  let endState = { type: "continue" };
  const blockingTool = toolCalls.find(
    (tc) => tc.name === "ask_user" || tc.name === "request_task_approval"
  );
  if (blockingTool) {
    endState = {
      type: "blocking_tool",
      toolName: blockingTool.name,
      toolCallId: blockingTool.id
    };
  } else if (msg.status === "error") {
    endState = { type: "error", message: msg.error || "Unknown error" };
  }
  const parsedToolCalls = toolCalls.map((tc) => ({
    id: tc.id,
    name: tc.name,
    arguments: tc.arguments
  }));
  const responseData = {
    rawContent: msg.content,
    strippedContent: msg.content,
    parsedToolCalls,
    hasToolCalls: toolCalls.length > 0,
    model: void 0
  };
  return {
    id: v4_default(),
    index,
    mode: msg.isPlan ? "planning" : "execution",
    request: {
      systemPrompt: "[Migrated - original system prompt not available]",
      messages: [],
      contextSources: [],
      estimatedTokens: 0
    },
    response: responseData,
    toolCalls,
    timing: {
      startedAt: msg.timestamp,
      endedAt: msg.timestamp + 1e3
      // Approximate
    },
    endState
  };
}
function convertToolCall(tc) {
  return {
    id: tc.id,
    name: tc.name,
    arguments: tc.arguments,
    status: tc.status === "approved" ? "complete" : tc.status,
    startedAt: tc.startedAt,
    completedAt: tc.completedAt,
    result: tc.result !== void 0 ? {
      success: tc.status === "complete",
      data: tc.result,
      error: tc.error
    } : void 0,
    blocking: tc.name === "ask_user" || tc.name === "request_task_approval",
    // Cache file content if available
    cachedContent: tc.name === "read_file" && typeof tc.result === "string" ? tc.result : void 0
  };
}
function ensureNewFormat(data) {
  if (isNewFormat(data)) {
    return data;
  }
  if (isOldFormat(data)) {
    return migrateConversation(data);
  }
  return null;
}
function convertToOldFormat(log) {
  const messages = [];
  for (const userMsg of log.userMessages) {
    messages.push({
      id: userMsg.id,
      role: "user",
      content: userMsg.inResponseTo ? `[User Response] ${userMsg.content}` : userMsg.content,
      timestamp: userMsg.timestamp,
      status: "complete"
    });
  }
  for (const iteration of log.iterations) {
    if (iteration.toolCalls.length > 0) {
      const toolResultsContent = iteration.toolCalls.filter((tc) => tc.status === "complete" && tc.result).map((tc) => {
        const resultStr = typeof tc.result?.data === "string" ? tc.result.data : JSON.stringify(tc.result?.data);
        return `Tool "${tc.name}":
${resultStr}`;
      }).join("\n\n---\n\n");
      if (toolResultsContent) {
        messages.push({
          id: v4_default(),
          role: "user",
          content: `[Tool Results]

${toolResultsContent}`,
          timestamp: iteration.timing.startedAt,
          status: "complete"
        });
      }
    }
    const toolCalls = iteration.toolCalls.map((tc) => ({
      id: tc.id,
      name: tc.name,
      arguments: tc.arguments,
      status: tc.status === "complete" ? "complete" : tc.status,
      result: tc.result?.data,
      error: tc.result?.error,
      startedAt: tc.startedAt,
      completedAt: tc.completedAt
    }));
    messages.push({
      id: iteration.id,
      role: "assistant",
      content: iteration.response.strippedContent,
      timestamp: iteration.timing.startedAt,
      toolCalls,
      isPlan: iteration.mode === "planning",
      status: "complete"
    });
  }
  messages.sort((a, b) => a.timestamp - b.timestamp);
  return {
    id: log.id,
    title: log.title,
    workspaceId: log.filebarId,
    messages,
    createdAt: log.createdAt,
    updatedAt: log.updatedAt
  };
}
function getDisplayMessages(log) {
  const messages = [];
  let userMsgIndex = 0;
  let iterIndex = 0;
  while (userMsgIndex < log.userMessages.length || iterIndex < log.iterations.length) {
    const nextUser = log.userMessages[userMsgIndex];
    const nextIter = log.iterations[iterIndex];
    const userTime = nextUser?.timestamp ?? Infinity;
    const iterTime = nextIter?.timing.startedAt ?? Infinity;
    if (userTime <= iterTime && nextUser) {
      messages.push({
        id: nextUser.id,
        role: "user",
        content: nextUser.content,
        timestamp: nextUser.timestamp,
        status: "complete"
      });
      userMsgIndex++;
    } else if (nextIter) {
      const consultBossCalls = nextIter.toolCalls.filter(
        (tc) => tc.name === "consult_boss" && tc.status === "complete"
      );
      for (const tc of consultBossCalls) {
        const args = tc.arguments;
        if (args.message) {
          messages.push({
            id: tc.id,
            role: "assistant",
            content: args.message,
            timestamp: tc.completedAt || tc.startedAt,
            status: "complete"
          });
        }
      }
      iterIndex++;
    }
  }
  return messages;
}

// ../../electron/markus/conversations.ts
import path10 from "path";
import fs14 from "fs/promises";
import { existsSync as existsSync10 } from "fs";
function getWorkspaceId(folders) {
  if (folders.length === 0) {
    return "default";
  }
  const sortedFolders = [...folders].sort();
  const combined = sortedFolders.join("|");
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}
export {
  DEFAULT_LOOP_CONFIG,
  DEFAULT_TOOLS,
  IndexManager,
  LoopController,
  TOOL_DEFINITIONS,
  TOOL_PRESETS,
  VectorStore,
  addIteration,
  addTask,
  addUserMessage,
  buildContext,
  buildInitialContext,
  buildOrchestratorTools,
  buildSystemPrompt,
  chunkDocument,
  contextToLLMMessages,
  convertToOldFormat,
  createEmbeddingProvider,
  createLLMClient,
  createLog,
  createRequestContext,
  createTaskList,
  deleteLog,
  ensureNewFormat,
  ensureSettingsFile,
  estimateTokens3 as estimateTokens,
  executeTool,
  formatTaskListForPrompt,
  getAgentSettings,
  getBlockingToolCall,
  getConfigDir,
  getConsultBossMessages,
  getConversationAgents,
  getConversationIndexManager,
  getDisplayMessages,
  getFileReadCache,
  getIndexManager,
  getRAGIndexStatus,
  getRAGSettings,
  getRecentIterations,
  getSettingsPath,
  getWorkspaceId,
  initializeForConversation,
  initializeMultiAgentSystem,
  isInitializedForConversation,
  isMultiAgentEnabled,
  isInitialized as isMultiAgentInitialized,
  isNewFormat,
  isOldFormat,
  listLogs,
  loadLog,
  loadTaskList,
  migrateConversation,
  readSettings,
  reindexWorkspace,
  removeTask,
  resetIndexManager,
  runThoughtLoop,
  saveLog,
  saveTaskList,
  searchRAG,
  setError,
  setMode,
  shutdownConversation,
  shutdownMultiAgentSystem,
  summarizeIteration,
  updateTaskStatus,
  updateTasks,
  validateSettings,
  writeSettings
};
