/**
 * Markus Client Library
 *
 * Client for connecting to the Markus standalone server.
 * Provides a unified interface for both HTTP and WebSocket communication.
 */

// ============================================================================
// Types
// ============================================================================

export interface ConversationInfo {
  id: string
  workspaceFolders: string[]
  filebarId: string
  createdAt: number
  title?: string
  agentIds?: string[]
}

export interface CreateConversationOptions {
  workspaceFolders: string[]
  filebarId?: string
  /** Agent definition IDs to use for this conversation */
  agentIds?: string[]
}

// ============================================================================
// Agent Definition Types
// ============================================================================

export interface AgentDefinition {
  id: string
  slug: string
  name: string
  roleDefinition: string
  whenToUse: string
  description: string
  customInstructions?: string
  model: string
  endpoint: string
  apiKey?: string
  maxTokens: number
  temperature: number
  timeout?: number
  /** Which tools this agent can use (tool names). Omit for default set. */
  tools?: string[]
  createdAt: number
  updatedAt: number
}

export interface CreateAgentDefinitionOptions {
  slug: string
  name: string
  roleDefinition: string
  whenToUse: string
  description: string
  customInstructions?: string
  model: string
  endpoint: string
  apiKey?: string
  maxTokens?: number
  temperature?: number
  timeout?: number
  /** Which tools this agent can use (tool names). Omit for default set. */
  tools?: string[]
}

export interface UpdateAgentDefinitionOptions {
  slug?: string
  name?: string
  roleDefinition?: string
  whenToUse?: string
  description?: string
  customInstructions?: string
  model?: string
  endpoint?: string
  apiKey?: string
  maxTokens?: number
  temperature?: number
  timeout?: number
  /** Which tools this agent can use (tool names). Omit for default set. */
  tools?: string[]
}

export interface MessageOptions {
  planningMode: boolean
  yoloMode: boolean
}

export interface ToolCallInfo {
  id: string
  name: string
  arguments: Record<string, unknown>
  blocking?: boolean
}

export interface ToolCallResult {
  success: boolean
  data?: unknown
  error?: string
}

export interface BlockingToolUI {
  type: 'ask_user' | 'approval' | 'consult_boss'
  question?: string
  options?: string[]
  reason?: string
  summary?: string
  filesChanged?: string[]
  message?: string
  messageType?: 'info' | 'success' | 'warning' | 'error' | 'progress'
}

export interface Task {
  id: string
  description: string
  status: 'pending' | 'in_progress' | 'done' | 'blocked'
  priority: number
  blockedBy?: string
  completedAt?: number
}

export interface MarkusSettings {
  llm: {
    apiEndpoint: string
    apiKey: string
    model: string
    maxTokens?: number
    temperature?: number
  }
  search: {
    searxngUrl?: string
    useDuckDuckGo: boolean
  }
  defaultPlanningMode: boolean
  yoloMode: boolean
}

// ============================================================================
// Event Types
// ============================================================================

export type ConnectionEvent =
  | { type: 'connected' }
  | { type: 'disconnected'; reason?: string }
  | { type: 'error'; error: string }

export type MessageEvent =
  | { type: 'chunk'; content: string }
  | { type: 'tool_started'; toolCall: ToolCallInfo }
  | { type: 'tool_complete'; toolCallId: string; result: ToolCallResult }
  | { type: 'blocking'; toolCallId: string; uiData: BlockingToolUI }
  | { type: 'tasks_updated'; tasks: Task[] }
  | { type: 'complete'; waitingForInput: boolean }
  | { type: 'error'; message: string }
  | { type: 'iteration_started'; iterationIndex: number }

export type EventHandler<T> = (event: T) => void

// ============================================================================
// MarkusConnection Class
// ============================================================================

/**
 * Represents a WebSocket connection to a specific conversation.
 */
export class MarkusConnection {
  private ws: WebSocket | null = null
  private connectionHandlers = new Set<EventHandler<ConnectionEvent>>()
  private messageHandlers = new Set<EventHandler<MessageEvent>>()
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000

  constructor(
    private serverUrl: string,
    private conversationId: string
  ) {}

  /**
   * Connects to the WebSocket server.
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = this.serverUrl.replace(/^http/, 'ws')
      const url = `${wsUrl}/ws?conversationId=${this.conversationId}`

      this.ws = new WebSocket(url)

      this.ws.onopen = () => {
        this.reconnectAttempts = 0
        this.emitConnection({ type: 'connected' })
        resolve()
      }

      this.ws.onerror = (event) => {
        console.error('[MarkusConnection] WebSocket error:', event)
        reject(new Error('WebSocket connection failed'))
      }

      this.ws.onclose = (event) => {
        this.emitConnection({
          type: 'disconnected',
          reason: event.reason || `Code: ${event.code}`
        })

        // Attempt reconnection if not intentional close
        if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++
          console.log(`[MarkusConnection] Reconnecting... (attempt ${this.reconnectAttempts})`)
          setTimeout(() => this.connect().catch(console.error), this.reconnectDelay)
        }
      }

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as MessageEvent
          this.emitMessage(message)
        } catch (error) {
          console.error('[MarkusConnection] Error parsing message:', error)
        }
      }
    })
  }

  /**
   * Disconnects from the WebSocket server.
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect')
      this.ws = null
    }
  }

  /**
   * Sends a chat message to the server.
   */
  sendMessage(content: string, options: MessageOptions): void {
    this.send({
      type: 'message',
      content,
      planningMode: options.planningMode,
      yoloMode: options.yoloMode
    })
  }

  /**
   * Responds to a blocking tool (ask_user, approval).
   */
  respondToTool(toolCallId: string, response: string | boolean): void {
    this.send({
      type: 'tool_response',
      toolCallId,
      response
    })
  }

  /**
   * Cancels the current request.
   */
  cancel(): void {
    this.send({ type: 'cancel' })
  }

  /**
   * Subscribes to connection events.
   */
  onConnection(handler: EventHandler<ConnectionEvent>): () => void {
    this.connectionHandlers.add(handler)
    return () => this.connectionHandlers.delete(handler)
  }

  /**
   * Subscribes to message events.
   */
  onMessage(handler: EventHandler<MessageEvent>): () => void {
    this.messageHandlers.add(handler)
    return () => this.messageHandlers.delete(handler)
  }

  /**
   * Checks if the connection is open.
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  private send(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
    } else {
      console.warn('[MarkusConnection] Cannot send - not connected')
    }
  }

  private emitConnection(event: ConnectionEvent): void {
    for (const handler of this.connectionHandlers) {
      handler(event)
    }
  }

  private emitMessage(event: MessageEvent): void {
    for (const handler of this.messageHandlers) {
      handler(event)
    }
  }
}

// ============================================================================
// MarkusClient Class
// ============================================================================

/**
 * Client for the Markus standalone server.
 * Provides methods for conversation management and connecting to conversations.
 */
export class MarkusClient {
  constructor(private serverUrl: string = 'http://localhost:3847') {
    // Ensure URL doesn't end with /
    this.serverUrl = serverUrl.replace(/\/$/, '')
  }

  // ========================================================================
  // Conversation Management
  // ========================================================================

  /**
   * Creates a new conversation.
   */
  async createConversation(options: CreateConversationOptions): Promise<ConversationInfo> {
    const response = await fetch(`${this.serverUrl}/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options)
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to create conversation')
    }

    return response.json()
  }

  /**
   * Gets a conversation by ID.
   */
  async getConversation(id: string): Promise<ConversationInfo> {
    const response = await fetch(`${this.serverUrl}/conversations/${id}`)

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Conversation not found')
      }
      const error = await response.json()
      throw new Error(error.error || 'Failed to get conversation')
    }

    return response.json()
  }

  /**
   * Lists all conversations.
   */
  async listConversations(): Promise<ConversationInfo[]> {
    const response = await fetch(`${this.serverUrl}/conversations`)

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to list conversations')
    }

    return response.json()
  }

  /**
   * Deletes a conversation.
   */
  async deleteConversation(id: string): Promise<void> {
    const response = await fetch(`${this.serverUrl}/conversations/${id}`, {
      method: 'DELETE'
    })

    if (!response.ok && response.status !== 404) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to delete conversation')
    }
  }

  /**
   * Cancels an active request for a conversation.
   */
  async cancelRequest(id: string): Promise<void> {
    const response = await fetch(`${this.serverUrl}/conversations/${id}/cancel`, {
      method: 'POST'
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to cancel request')
    }
  }

  // ========================================================================
  // WebSocket Connections
  // ========================================================================

  /**
   * Creates a connection to a conversation.
   * Call connect() on the returned connection to start.
   */
  connect(conversationId: string): MarkusConnection {
    return new MarkusConnection(this.serverUrl, conversationId)
  }

  // ========================================================================
  // Agent Definitions
  // ========================================================================

  /**
   * Creates a new agent definition.
   */
  async createAgentDefinition(options: CreateAgentDefinitionOptions): Promise<AgentDefinition> {
    const response = await fetch(`${this.serverUrl}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options)
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to create agent definition')
    }

    return response.json()
  }

  /**
   * Lists all agent definitions.
   */
  async listAgentDefinitions(): Promise<AgentDefinition[]> {
    const response = await fetch(`${this.serverUrl}/agents`)

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to list agent definitions')
    }

    return response.json()
  }

  /**
   * Gets a specific agent definition.
   */
  async getAgentDefinition(id: string): Promise<AgentDefinition> {
    const response = await fetch(`${this.serverUrl}/agents/${id}`)

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Agent definition not found')
      }
      const error = await response.json()
      throw new Error(error.error || 'Failed to get agent definition')
    }

    return response.json()
  }

  /**
   * Updates an agent definition.
   */
  async updateAgentDefinition(id: string, updates: UpdateAgentDefinitionOptions): Promise<AgentDefinition> {
    const response = await fetch(`${this.serverUrl}/agents/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    })

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Agent definition not found')
      }
      const error = await response.json()
      throw new Error(error.error || 'Failed to update agent definition')
    }

    return response.json()
  }

  /**
   * Gets available tool presets for agent configuration.
   */
  async getToolPresets(): Promise<{ presets: Record<string, string[]>; default: string[] }> {
    const response = await fetch(`${this.serverUrl}/agents/tool-presets`)

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to get tool presets')
    }

    return response.json()
  }

  /**
   * Deletes an agent definition.
   */
  async deleteAgentDefinition(id: string): Promise<void> {
    const response = await fetch(`${this.serverUrl}/agents/${id}`, {
      method: 'DELETE'
    })

    if (!response.ok && response.status !== 404) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to delete agent definition')
    }
  }

  // ========================================================================
  // Settings
  // ========================================================================

  /**
   * Gets current settings.
   */
  async getSettings(): Promise<MarkusSettings> {
    const response = await fetch(`${this.serverUrl}/settings`)

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to get settings')
    }

    return response.json()
  }

  /**
   * Updates settings.
   */
  async updateSettings(settings: Partial<MarkusSettings>): Promise<void> {
    const response = await fetch(`${this.serverUrl}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to update settings')
    }
  }

  /**
   * Validates current settings.
   */
  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const response = await fetch(`${this.serverUrl}/settings/validate`)

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to validate settings')
    }

    return response.json()
  }

  // ========================================================================
  // Health Check
  // ========================================================================

  /**
   * Checks if the server is healthy.
   */
  async health(): Promise<{ status: string; version: string; uptime: number }> {
    const response = await fetch(`${this.serverUrl}/health`)

    if (!response.ok) {
      throw new Error('Server is not healthy')
    }

    return response.json()
  }
}

/**
 * Creates a Markus client instance.
 */
export function createMarkusClient(serverUrl?: string): MarkusClient {
  return new MarkusClient(serverUrl)
}
