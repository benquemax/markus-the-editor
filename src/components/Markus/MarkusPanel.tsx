/**
 * MarkusPanel Component
 *
 * Main container for the Markus AI agent interface.
 * Connects to the standalone Markus server via HTTP/WebSocket.
 *
 * Features:
 * - Agent status badges showing which agents are working
 * - Thinking indicator with iteration progress
 * - Debug panel for conversation inspection
 *
 * Architecture:
 * - Uses MarkusClient for HTTP operations (create conversation, get settings)
 * - Uses MarkusConnection for WebSocket streaming (messages, tool calls)
 * - Markus server runs separately from Electron app
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { Settings, AlertCircle, Loader2, WifiOff } from 'lucide-react'
import { ConversationHeader } from './ConversationHeader'
import { AgentSelector } from './AgentSelector'
import MarkdownIt from 'markdown-it'

// Initialize markdown parser
const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: true
})
import { ChatMessage } from './ChatMessage'
import { AgentDefinitionsPanel } from './AgentDefinitionsPanel'
import { ChatInput } from './ChatInput'
import { AgentActivityDisplay } from './AgentActivityDisplay'
import { ConversationDebugPanel } from './ConversationDebugPanel'
import { TaskListPanel } from './TaskListPanel'
import { AskUserDialog } from './AskUserDialog'
import { ApprovalDialog } from './ApprovalDialog'
import { ThinkingWidget } from './ThinkingWidget'
import {
  createMarkusClient,
  MarkusClient,
  MarkusConnection,
  type AgentDefinition,
  type ConversationInfo,
  type MessageEvent,
  type BlockingToolUI,
  type Task
} from '../../lib/markus/client'
import type {
  MarkusConversation,
  MarkusToolCallRecord,
  AgentStatusInfo
} from '../../lib/markus/types'

// Server URL - can be configured via environment or settings
const MARKUS_SERVER_URL = 'http://localhost:3847'

interface MarkusPanelProps {
  workspaceFolders: string[]
  openFiles: string[]
}

export function MarkusPanel({ workspaceFolders }: MarkusPanelProps) {
  // Client and connection state
  const clientRef = useRef<MarkusClient | null>(null)
  const connectionRef = useRef<MarkusConnection | null>(null)
  const [serverConnected, setServerConnected] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  // Conversation state
  const [conversationInfo, setConversationInfo] = useState<ConversationInfo | null>(null)
  const [conversation, setConversation] = useState<MarkusConversation | null>(null)
  const [isConfigured, setIsConfigured] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  // Streaming state
  const [streamingContent, setStreamingContent] = useState('')
  const [streamingToolCalls, setStreamingToolCalls] = useState<MarkusToolCallRecord[]>([])
  const [previousIterations, setPreviousIterations] = useState<string[]>([])

  // Mode state
  const [planningMode, setPlanningMode] = useState(true)
  const [yoloMode, setYoloMode] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Refs for scroll handling
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const isUserScrolledUp = useRef(false)

  // Refs to capture latest state for event handlers
  const streamingContentRef = useRef(streamingContent)
  const streamingToolCallsRef = useRef(streamingToolCalls)
  streamingContentRef.current = streamingContent
  streamingToolCallsRef.current = streamingToolCalls

  // Multi-agent state (placeholder - will be added to server later)
  const [agentStatuses] = useState<AgentStatusInfo[]>([])

  // Agent selection state — which API-defined agents to use for new conversations
  const [agentDefinitions, setAgentDefinitions] = useState<AgentDefinition[]>([])
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(new Set())

  // Settings panel state
  const [showSettings, setShowSettings] = useState(false)

  // Thought loop state
  const [tasks, setTasks] = useState<Task[]>([])
  const [blockingUI, setBlockingUI] = useState<BlockingToolUI | null>(null)
  const [blockingToolCallId, setBlockingToolCallId] = useState<string | null>(null)

  // Check if user has scrolled to the bottom
  const checkIfAtBottom = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) return true
    const threshold = 100
    return container.scrollHeight - container.scrollTop - container.clientHeight < threshold
  }, [])

  // Handle scroll events
  const handleScroll = useCallback(() => {
    isUserScrolledUp.current = !checkIfAtBottom()
  }, [checkIfAtBottom])

  // Scroll to bottom
  const scrollToBottom = useCallback(() => {
    if (!isUserScrolledUp.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [])

  // Initialize client and check server connection
  useEffect(() => {
    const initClient = async () => {
      const client = createMarkusClient(MARKUS_SERVER_URL)
      clientRef.current = client

      try {
        // Check server health
        await client.health()
        setServerConnected(true)
        setServerError(null)

        // Load settings and validate
        const settings = await client.getSettings()
        setPlanningMode(settings.defaultPlanningMode)
        setYoloMode(settings.yoloMode)

        const validation = await client.validateSettings()
        setIsConfigured(validation.valid)

        // Fetch available agent definitions and pre-select all
        try {
          const agents = await client.listAgentDefinitions()
          setAgentDefinitions(agents)
          setSelectedAgentIds(new Set(agents.map(a => a.id)))
        } catch {
          // Agent API may not be available — that's fine
        }
      } catch (err) {
        setServerConnected(false)
        setServerError(err instanceof Error ? err.message : 'Failed to connect to server')
      }
    }

    initClient()

    // Cleanup on unmount
    return () => {
      connectionRef.current?.disconnect()
    }
  }, [])

  // Create or load conversation when workspace changes
  useEffect(() => {
    if (!clientRef.current || !serverConnected || workspaceFolders.length === 0) return

    const initConversation = async () => {
      try {
        // Create a new conversation for this workspace
        const agentIds = selectedAgentIds.size > 0 ? Array.from(selectedAgentIds) : undefined
        const info = await clientRef.current!.createConversation({
          workspaceFolders,
          agentIds
        })
        setConversationInfo(info)

        // Initialize empty conversation for UI
        setConversation({
          id: info.id,
          title: 'New Conversation',
          filebarId: info.filebarId,
          messages: [],
          createdAt: info.createdAt,
          updatedAt: info.createdAt
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create conversation')
      }
    }

    initConversation()
  }, [serverConnected, workspaceFolders])

  // Connect WebSocket when conversation is ready
  useEffect(() => {
    if (!conversationInfo || !clientRef.current) return

    const connectWebSocket = async () => {
      // Disconnect existing connection
      connectionRef.current?.disconnect()

      // Create new connection
      const connection = clientRef.current!.connect(conversationInfo.id)
      connectionRef.current = connection

      // Subscribe to message events
      connection.onMessage(handleMessageEvent)

      // Subscribe to connection events
      connection.onConnection((event) => {
        if (event.type === 'disconnected') {
          console.log('[MarkusPanel] WebSocket disconnected:', event.reason)
        } else if (event.type === 'error') {
          setError(event.error)
        }
      })

      try {
        await connection.connect()
        console.log('[MarkusPanel] WebSocket connected')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to connect WebSocket')
      }
    }

    connectWebSocket()

    return () => {
      connectionRef.current?.disconnect()
    }
  }, [conversationInfo])

  // Handle WebSocket message events
  const handleMessageEvent = useCallback((event: MessageEvent) => {
    switch (event.type) {
      case 'chunk':
        setStreamingContent(prev => prev + event.content)
        scrollToBottom()
        break

      case 'iteration_started':
        // Save current content to history and start fresh
        setStreamingContent(prev => {
          if (prev.trim()) {
            setPreviousIterations(history => [...history, prev])
          }
          return ''
        })
        break

      case 'tool_started':
        setStreamingToolCalls(prev => {
          // Deduplicate by ID to prevent doubled tool calls
          const existingIds = new Set(prev.map(tc => tc.id))
          if (existingIds.has(event.toolCall.id)) return prev
          return [...prev, {
            id: event.toolCall.id,
            name: event.toolCall.name,
            arguments: event.toolCall.arguments,
            status: 'executing' as const,
            startedAt: Date.now()
          }]
        })
        scrollToBottom()
        break

      case 'tool_complete':
        setStreamingToolCalls(prev => prev.map(tc =>
          tc.id === event.toolCallId
            ? { ...tc, status: 'complete' as const, result: event.result }
            : tc
        ))
        break

      case 'blocking':
        setBlockingUI(event.uiData)
        setBlockingToolCallId(event.toolCallId)
        break

      case 'tasks_updated':
        setTasks(event.tasks)
        break

      case 'complete': {
        setIsLoading(false)
        // Use refs to get the latest state (avoiding stale closure)
        const finalContent = streamingContentRef.current
        const finalToolCalls = streamingToolCallsRef.current
        // Add assistant message to conversation
        if (finalContent.trim() || finalToolCalls.length > 0) {
          setConversation(prev => {
            if (!prev) return prev
            return {
              ...prev,
              messages: [
                ...prev.messages,
                {
                  id: crypto.randomUUID(),
                  role: 'assistant' as const,
                  content: finalContent,
                  timestamp: Date.now(),
                  status: 'complete' as const,
                  toolCalls: finalToolCalls
                }
              ],
              updatedAt: Date.now()
            }
          })
        }
        setStreamingContent('')
        setStreamingToolCalls([])
        setPreviousIterations([])
        isUserScrolledUp.current = false
        break
      }

      case 'error':
        setIsLoading(false)
        setStreamingContent('')
        setStreamingToolCalls([])
        setPreviousIterations([])
        isUserScrolledUp.current = false
        setError(event.message)
        break
    }
  }, [scrollToBottom])

  // Handle sending a message
  const handleSendMessage = useCallback(async (message: string) => {
    if (!connectionRef.current || !message.trim() || isLoading) return

    setError(null)
    setIsLoading(true)
    setStreamingContent('')

    // Add user message to conversation
    setConversation(prev => {
      if (!prev) return prev
      return {
        ...prev,
        messages: [
          ...prev.messages,
          {
            id: crypto.randomUUID(),
            role: 'user' as const,
            content: message.trim(),
            timestamp: Date.now(),
            status: 'complete' as const
          }
        ],
        updatedAt: Date.now()
      }
    })

    // Send via WebSocket
    connectionRef.current.sendMessage(message.trim(), {
      planningMode,
      yoloMode
    })
  }, [isLoading, planningMode, yoloMode])

  // Handle creating a new conversation
  const handleNewConversation = useCallback(async () => {
    if (!clientRef.current) return

    try {
      const agentIds = selectedAgentIds.size > 0 ? Array.from(selectedAgentIds) : undefined
      const info = await clientRef.current.createConversation({
        workspaceFolders,
        agentIds
      })
      setConversationInfo(info)
      setConversation({
        id: info.id,
        title: 'New Conversation',
        filebarId: info.filebarId,
        messages: [],
        createdAt: info.createdAt,
        updatedAt: info.createdAt
      })
      setTasks([])
      setBlockingUI(null)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create conversation')
    }
  }, [workspaceFolders, selectedAgentIds])

  // Handle loading a conversation (placeholder - needs server endpoint)
  const handleLoadConversation = useCallback(async (conversationId: string) => {
    // TODO: Need to add message history endpoint to server
    console.log('[MarkusPanel] Loading conversation:', conversationId)
    setError('Loading conversations not yet supported in server mode')
  }, [])

  // Handle canceling the current request
  const handleCancel = useCallback(() => {
    if (!connectionRef.current) return
    connectionRef.current.cancel()
    setIsLoading(false)
    setStreamingContent('')
  }, [])

  // Toggle an agent in the selection set
  const handleToggleAgent = useCallback((id: string) => {
    setSelectedAgentIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  // Handle opening settings (in-app agent definitions panel)
  const handleOpenSettings = useCallback(() => {
    setShowSettings(true)
  }, [])

  // Handle agents changed from settings panel
  const handleAgentsChanged = useCallback(async () => {
    if (!clientRef.current) return
    try {
      const agents = await clientRef.current.listAgentDefinitions()
      setAgentDefinitions(agents)
      setSelectedAgentIds(new Set(agents.map(a => a.id)))
    } catch {
      // Ignore - agents may not be available
    }
  }, [])

  // Handle user response to ask_user blocking tool
  const handleUserResponse = useCallback((response: string) => {
    if (!connectionRef.current || !blockingToolCallId) return

    setBlockingUI(null)

    // Add user response to conversation
    setConversation(prev => {
      if (!prev) return prev
      return {
        ...prev,
        messages: [
          ...prev.messages,
          {
            id: crypto.randomUUID(),
            role: 'user' as const,
            content: `[User Response] ${response}`,
            timestamp: Date.now(),
            status: 'complete' as const
          }
        ]
      }
    })

    // Send response via WebSocket
    connectionRef.current.respondToTool(blockingToolCallId, response)
    setBlockingToolCallId(null)
    setIsLoading(true)
  }, [blockingToolCallId])

  // Handle task approval
  const handleTaskApproval = useCallback(() => {
    if (!connectionRef.current || !blockingToolCallId) return

    setBlockingUI(null)
    setTasks([])

    // Send approval via WebSocket
    connectionRef.current.respondToTool(blockingToolCallId, true)
    setBlockingToolCallId(null)
  }, [blockingToolCallId])

  // Handle request for changes after approval dialog
  const handleRequestChanges = useCallback((feedback: string) => {
    if (!connectionRef.current || !blockingToolCallId) return

    setBlockingUI(null)

    // Send rejection with feedback
    connectionRef.current.respondToTool(blockingToolCallId, feedback)
    setBlockingToolCallId(null)
    setIsLoading(true)
  }, [blockingToolCallId])

  // Show server connection error
  if (!serverConnected) {
    return (
      <div className="h-full flex flex-col bg-muted/20">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Markus
          </span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <WifiOff className="w-12 h-12 text-amber-500 mb-4" />
          <h3 className="text-lg font-medium mb-2">Server Not Connected</h3>
          <p className="text-sm text-muted-foreground mb-4">
            {serverError || `Cannot connect to Markus server at ${MARKUS_SERVER_URL}`}
          </p>
          <p className="text-xs text-muted-foreground">
            Start the server with: <code className="bg-muted px-1 py-0.5 rounded">npm run start</code> in packages/markus-server
          </p>
        </div>
      </div>
    )
  }

  // Show configuration prompt if not configured
  if (!isConfigured) {
    return (
      <div className="h-full flex flex-col bg-muted/20">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Markus
          </span>
          <button
            onClick={handleOpenSettings}
            className="p-1 hover:bg-accent rounded"
            title="Open settings"
          >
            <Settings className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <AlertCircle className="w-12 h-12 text-amber-500 mb-4" />
          <h3 className="text-lg font-medium mb-2">Configure Markus</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Markus needs an API key to work. Click below to open the settings file.
          </p>
          <button
            onClick={handleOpenSettings}
            className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
          >
            Open Settings
          </button>
        </div>
      </div>
    )
  }

  // Render settings panel if open
  if (showSettings && clientRef.current) {
    return (
      <AgentDefinitionsPanel
        client={clientRef.current}
        onClose={() => setShowSettings(false)}
        onAgentsChanged={handleAgentsChanged}
      />
    )
  }

  return (
    <div className="h-full flex flex-col bg-muted/20">
      {/* Header */}
      <ConversationHeader
        conversation={conversation}
        onNewConversation={handleNewConversation}
        onLoadConversation={handleLoadConversation}
        onOpenSettings={handleOpenSettings}
      />

      {/* Agent Selection Strip */}
      <AgentSelector
        agents={agentDefinitions}
        selectedIds={selectedAgentIds}
        onToggle={handleToggleAgent}
      />

      {/* Task List Panel */}
      <TaskListPanel tasks={tasks} />

      {/* Agent Activity Display */}
      {agentStatuses.length > 0 && (
        <div className="px-3 py-1.5 border-b border-border/50 bg-muted/30">
          <AgentActivityDisplay agents={agentStatuses} compact />
        </div>
      )}

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto p-3 space-y-3 thin-scrollbar"
      >
        {conversation?.messages
          .filter((message) => !(isLoading && message.status === 'streaming'))
          .filter((message) => !message.content.startsWith('[Tool Results]'))
          .filter((message) => !(message.role === 'assistant' && !message.content.trim() && (!message.toolCalls || message.toolCalls.length === 0)))
          .map((message) => (
            <ChatMessage
              key={message.id}
              message={message}
            />
          ))}

        {/* Previous iterations' thinking */}
        {isLoading && previousIterations.map((content, index) => (
          <ThinkingWidget
            key={`prev-${index}`}
            streamingContent={content}
            isThinking={false}
          />
        ))}

        {/* Current iteration's thinking */}
        {isLoading && streamingContent && (
          <ThinkingWidget
            key="current-thinking"
            streamingContent={streamingContent}
            isThinking={true}
          />
        )}

        {/* Tool calls - only show consult_boss messages */}
        {isLoading && streamingToolCalls.length > 0 && (
          <div className="space-y-2">
            {streamingToolCalls.map(toolCall => {
              if (toolCall.name === 'consult_boss') {
                if (toolCall.status === 'complete') {
                  const args = toolCall.arguments as { message?: string; type?: string }
                  const message = args.message || ''
                  const type = args.type || 'info'
                  return (
                    <div
                      key={toolCall.id}
                      className={`p-3 rounded-lg border ${
                        type === 'success' ? 'bg-green-500/5 border-green-500/20' :
                        type === 'warning' ? 'bg-amber-500/5 border-amber-500/20' :
                        type === 'error' ? 'bg-red-500/5 border-red-500/20' :
                        'bg-blue-500/5 border-blue-500/20'
                      }`}
                    >
                      <div
                        className="prose prose-sm max-w-none dark:prose-invert"
                        dangerouslySetInnerHTML={{ __html: md.render(message) }}
                      />
                    </div>
                  )
                }
                return null
              }
              return null
            })}

            {/* Working indicator */}
            {streamingToolCalls.some(tc =>
              tc.status === 'executing' &&
              !['consult_boss', 'update_tasks', 'ask_user', 'request_task_approval'].includes(tc.name)
            ) && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground px-2 py-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Working...</span>
              </div>
            )}
          </div>
        )}

        {/* Blocking UI - ask_user dialog */}
        {blockingUI?.type === 'ask_user' && blockingUI.question && blockingUI.options && (
          <AskUserDialog
            question={blockingUI.question}
            options={blockingUI.options}
            reason={blockingUI.reason}
            onSubmit={handleUserResponse}
          />
        )}

        {/* Blocking UI - approval dialog */}
        {blockingUI?.type === 'approval' && blockingUI.summary && (
          <ApprovalDialog
            summary={blockingUI.summary}
            filesChanged={blockingUI.filesChanged}
            onApprove={handleTaskApproval}
            onRequestChanges={handleRequestChanges}
          />
        )}

        {/* Error display */}
        {error && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded text-sm text-destructive">
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Debug panel */}
      <div className="px-3 py-1 border-t border-border/30 flex justify-end">
        <ConversationDebugPanel conversation={conversation} />
      </div>

      {/* Input */}
      <ChatInput
        onSend={handleSendMessage}
        onCancel={handleCancel}
        isLoading={isLoading}
        planningMode={planningMode}
        yoloMode={yoloMode}
        onPlanningModeChange={setPlanningMode}
        onYoloModeChange={setYoloMode}
      />
    </div>
  )
}
