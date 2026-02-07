/**
 * MarkusPanel Component
 *
 * Main container for the Markus AI agent interface.
 * Displays chat messages, handles conversation management,
 * and provides controls for planning/YOLO modes.
 *
 * Features:
 * - Agent status badges showing which agents are working
 * - Thinking indicator with iteration progress
 * - Debug panel for conversation inspection
 *
 * Note: The backend now uses algorithmic context fabrication
 * (ConversationLog format) but converts to old Conversation format
 * for UI compatibility.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { Settings, AlertCircle, Loader2 } from 'lucide-react'
import { ConversationHeader } from './ConversationHeader'
import MarkdownIt from 'markdown-it'

// Initialize markdown parser
const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: true
})
import { ChatMessage } from './ChatMessage'
import { ChatInput } from './ChatInput'
import { AgentActivityDisplay } from './AgentActivityDisplay'
import { ConversationDebugPanel } from './ConversationDebugPanel'
import { TaskListPanel } from './TaskListPanel'
import { AskUserDialog } from './AskUserDialog'
import { ApprovalDialog } from './ApprovalDialog'
import { ThinkingWidget } from './ThinkingWidget'
import type {
  MarkusConversation,
  MarkusToolCallRecord,
  MarkusSettings,
  AgentStatusInfo,
  Task,
  BlockingToolUI
} from '../../lib/markus/types'

interface MarkusPanelProps {
  workspaceFolders: string[]
  openFiles: string[]
}

export function MarkusPanel({ workspaceFolders, openFiles }: MarkusPanelProps) {
  const [conversation, setConversation] = useState<MarkusConversation | null>(null)
  // Settings are loaded and used to set initial mode state
  const [, setSettings] = useState<MarkusSettings | null>(null)
  const [isConfigured, setIsConfigured] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  // Track current iteration's streaming content
  const [streamingContent, setStreamingContent] = useState('')
  // Track ALL tool calls across iterations (accumulated during request)
  const [streamingToolCalls, setStreamingToolCalls] = useState<MarkusToolCallRecord[]>([])
  // Track previous iterations' thinking content (for showing multiple thinking widgets)
  const [previousIterations, setPreviousIterations] = useState<string[]>([])
  const [planningMode, setPlanningMode] = useState(true)
  const [yoloMode, setYoloMode] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const isUserScrolledUp = useRef(false)

  // Multi-agent state
  const [agentStatuses, setAgentStatuses] = useState<AgentStatusInfo[]>([])

  // Thought loop state
  const [tasks, setTasks] = useState<Task[]>([])
  const [blockingUI, setBlockingUI] = useState<BlockingToolUI | null>(null)
  // Track if we're waiting for user input (blocking tool active)
  const [, setWaitingForInput] = useState(false)

  // Check if user has scrolled to the bottom (within threshold)
  const checkIfAtBottom = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) return true
    const threshold = 100 // pixels from bottom
    return container.scrollHeight - container.scrollTop - container.clientHeight < threshold
  }, [])

  // Handle scroll events to track if user scrolled up
  const handleScroll = useCallback(() => {
    isUserScrolledUp.current = !checkIfAtBottom()
  }, [checkIfAtBottom])

  // Scroll to bottom only if user hasn't scrolled up
  const scrollToBottom = useCallback(() => {
    if (!isUserScrolledUp.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [])

  // Load settings and latest conversation on mount
  useEffect(() => {
    const loadInitialState = async () => {
      try {
        const loadedSettings = await window.electron.markus.getSettings()
        setSettings(loadedSettings)
        setPlanningMode(loadedSettings.defaultPlanningMode)
        setYoloMode(loadedSettings.yoloMode)

        const validation = await window.electron.markus.validateSettings()
        setIsConfigured(validation.valid)

        const latestConv = await window.electron.markus.loadLatestConversation()
        if (latestConv) {
          setConversation(latestConv)
        } else {
          const newConv = await window.electron.markus.createConversation()
          setConversation(newConv)
        }
      } catch (err) {
        setError(String(err))
      }
    }

    loadInitialState()
  }, [])

  // Update workspace info in main process
  useEffect(() => {
    window.electron.markus.updateWorkspace(workspaceFolders)
  }, [workspaceFolders])

  useEffect(() => {
    window.electron.markus.updateOpenFiles(openFiles)
  }, [openFiles])

  // Fetch initial agent statuses
  useEffect(() => {
    const fetchAgentStatuses = async () => {
      try {
        const statuses = await window.electron.markus.getAgentStatuses()
        setAgentStatuses(statuses)
      } catch {
        // Silently fail - multi-agent might not be initialized
      }
    }
    fetchAgentStatuses()
  }, [])

  // Subscribe to agent status changes
  useEffect(() => {
    const unsubAgentStatus = window.electron.markus.onAgentStatus((data: AgentStatusInfo) => {
      setAgentStatuses(prev => {
        const existing = prev.findIndex(a => a.type === data.type)
        if (existing >= 0) {
          const updated = [...prev]
          updated[existing] = data
          return updated
        }
        return [...prev, data]
      })
    })

    return () => {
      unsubAgentStatus()
    }
  }, [])

  // Subscribe to task list updates
  useEffect(() => {
    const unsubTasksUpdated = window.electron.markus.onTasksUpdated((data: { conversationId: string; tasks: Task[] }) => {
      console.log('[MarkusPanel] Received tasksUpdated:', data.tasks.length, 'tasks, conversationId:', data.conversationId)
      console.log('[MarkusPanel] Current conversation?.id:', conversation?.id)
      if (data.conversationId === conversation?.id) {
        console.log('[MarkusPanel] Setting tasks:', data.tasks.map(t => t.description))
        setTasks(data.tasks)
      } else {
        console.log('[MarkusPanel] Ignoring - conversation ID mismatch')
      }
    })

    const unsubBlockingTool = window.electron.markus.onBlockingTool((data: { conversationId: string; uiData: BlockingToolUI }) => {
      if (data.conversationId === conversation?.id) {
        setBlockingUI(data.uiData)
        setWaitingForInput(true)
      }
    })

    return () => {
      unsubTasksUpdated()
      unsubBlockingTool()
    }
  }, [conversation?.id])

  // Load initial task list when conversation changes
  useEffect(() => {
    if (conversation?.id) {
      console.log('[MarkusPanel] Loading initial task list for conversation:', conversation.id)
      window.electron.markus.getTaskList(conversation.id).then((tasks: Task[]) => {
        console.log('[MarkusPanel] Initial task list loaded:', tasks.length, 'tasks')
        setTasks(tasks)
      })
    } else {
      setTasks([])
    }
    // Clear blocking UI when conversation changes
    setBlockingUI(null)
    setWaitingForInput(false)
  }, [conversation?.id])

  // Subscribe to streaming events
  useEffect(() => {
    const unsubChunk = window.electron.markus.onMessageChunk((data: { conversationId: string; chunk: string }) => {
      if (data.conversationId === conversation?.id) {
        // Empty chunk signals new iteration started
        if (data.chunk === '') {
          // Save current iteration's content to history (if any)
          setStreamingContent(prev => {
            if (prev.trim()) {
              setPreviousIterations(history => [...history, prev])
            }
            return '' // Start fresh for new iteration
          })
          // DON'T reset tool calls - they accumulate across iterations
        } else {
          setStreamingContent(prev => prev + data.chunk)
        }
        scrollToBottom()
      }
    })

    const unsubToolStart = window.electron.markus.onToolCallStarted((data: { conversationId: string; toolCall: MarkusToolCallRecord }) => {
      if (data.conversationId === conversation?.id) {
        // Add to streaming tool calls (for current message being streamed)
        setStreamingToolCalls(prev => {
          const existingIds = new Set(prev.map(tc => tc.id))
          if (existingIds.has(data.toolCall.id)) return prev
          return [...prev, data.toolCall]
        })
        scrollToBottom()
      }
    })

    const unsubToolComplete = window.electron.markus.onToolCallComplete((data: { conversationId: string; toolCallId: string; result: unknown }) => {
      if (data.conversationId === conversation?.id) {
        // Update streaming tool calls
        setStreamingToolCalls(prev => prev.map(tc =>
          tc.id === data.toolCallId
            ? { ...tc, status: 'complete' as const, result: data.result }
            : tc
        ))
      }
    })

    const unsubComplete = window.electron.markus.onRequestComplete((data: { conversationId: string; messageId: string; waitingForInput?: boolean }) => {
      if (data.conversationId === conversation?.id) {
        setIsLoading(false)
        setStreamingContent('')
        setStreamingToolCalls([])
        setPreviousIterations([])
        // Reset scroll tracking for next request
        isUserScrolledUp.current = false
        // Set waiting state if blocking tool was executed
        if (data.waitingForInput) {
          setWaitingForInput(true)
        }
        // Reload conversation to get final state
        window.electron.markus.loadConversation(data.conversationId).then((conv: MarkusConversation | null) => {
          if (conv) setConversation(conv)
        })
      }
    })

    const unsubError = window.electron.markus.onRequestError((data: { conversationId: string; error: string }) => {
      if (data.conversationId === conversation?.id) {
        setIsLoading(false)
        setStreamingContent('')
        setStreamingToolCalls([])
        setPreviousIterations([])
        isUserScrolledUp.current = false
        setError(data.error)
      }
    })

    return () => {
      unsubChunk()
      unsubToolStart()
      unsubToolComplete()
      unsubComplete()
      unsubError()
    }
  }, [conversation?.id, scrollToBottom])

  // Handle sending a message
  const handleSendMessage = useCallback(async (message: string) => {
    if (!conversation || !message.trim() || isLoading) return

    setError(null)
    setIsLoading(true)
    setStreamingContent('')

    try {
      const result = await window.electron.markus.sendMessage({
        conversation,
        message: message.trim(),
        planningMode,
        yoloMode
      })

      if (!result.success) {
        setError(result.error || 'Failed to send message')
        setIsLoading(false)
      } else if (result.conversation) {
        setConversation(result.conversation)
      }
    } catch (err) {
      setError(String(err))
      setIsLoading(false)
    }
  }, [conversation, isLoading, planningMode, yoloMode])

  // Handle creating a new conversation
  const handleNewConversation = useCallback(async () => {
    try {
      const newConv = await window.electron.markus.createConversation()
      setConversation(newConv)
      setError(null)
    } catch (err) {
      setError(String(err))
    }
  }, [])

  // Handle loading a conversation
  const handleLoadConversation = useCallback(async (conversationId: string) => {
    try {
      const conv = await window.electron.markus.loadConversation(conversationId)
      if (conv) {
        setConversation(conv)
        setError(null)
      }
    } catch (err) {
      setError(String(err))
    }
  }, [])

  // Handle canceling the current request
  const handleCancel = useCallback(async () => {
    if (!conversation) return
    await window.electron.markus.cancelRequest(conversation.id)
    setIsLoading(false)
    setStreamingContent('')
  }, [conversation])

  // Handle opening settings
  const handleOpenSettings = useCallback(async () => {
    await window.electron.markus.openSettings()
  }, [])

  // Handle user response to ask_user blocking tool
  const handleUserResponse = useCallback(async (response: string) => {
    if (!conversation) return

    setBlockingUI(null)
    setWaitingForInput(false)

    // Add the user response to the local conversation state
    const updatedConversation: MarkusConversation = {
      ...conversation,
      messages: [
        ...conversation.messages,
        {
          id: crypto.randomUUID(),
          role: 'user' as const,
          content: `[User Response] ${response}`,
          timestamp: Date.now(),
          status: 'complete' as const
        }
      ]
    }
    setConversation(updatedConversation)

    // Continue the thought loop (empty message = just continue, don't add another user message)
    setIsLoading(true)
    try {
      const result = await window.electron.markus.sendMessage({
        conversation: updatedConversation,
        message: '', // Empty = continuation, handler will skip adding user message
        planningMode,
        yoloMode
      })
      if (result.conversation) {
        setConversation(result.conversation)
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setIsLoading(false)
    }
  }, [conversation, planningMode, yoloMode])

  // Handle task approval
  const handleTaskApproval = useCallback(async () => {
    if (!conversation) return

    setBlockingUI(null)
    setWaitingForInput(false)
    setTasks([])

    await window.electron.markus.approveTask({
      conversationId: conversation.id
    })
  }, [conversation])

  // Handle request for changes after approval dialog
  const handleRequestChanges = useCallback(async (feedback: string) => {
    if (!conversation) return

    setBlockingUI(null)
    setWaitingForInput(false)

    // Send the feedback as a new message to continue the conversation
    setIsLoading(true)
    try {
      const result = await window.electron.markus.sendMessage({
        conversation,
        message: feedback,
        planningMode,
        yoloMode
      })
      if (result.conversation) {
        setConversation(result.conversation)
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setIsLoading(false)
    }
  }, [conversation, planningMode, yoloMode])

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

  return (
    <div className="h-full flex flex-col bg-muted/20">
      {/* Header */}
      <ConversationHeader
        conversation={conversation}
        onNewConversation={handleNewConversation}
        onLoadConversation={handleLoadConversation}
        onOpenSettings={handleOpenSettings}
      />

      {/* Task List Panel - shows current tasks */}
      <TaskListPanel tasks={tasks} />

      {/* Agent Activity Display - shows which agents are working */}
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
          // Filter out the streaming placeholder message to avoid showing it twice
          // (once from conversation.messages, once from streamingContent below)
          .filter((message) => !(isLoading && message.status === 'streaming'))
          // Filter out internal "[Tool Results]" messages - these are for LLM context only
          .filter((message) => !message.content.startsWith('[Tool Results]'))
          // Filter out empty assistant messages (created during tool execution loops)
          .filter((message) => !(message.role === 'assistant' && !message.content.trim() && (!message.toolCalls || message.toolCalls.length === 0)))
          .map((message) => (
            <ChatMessage
              key={message.id}
              message={message}
            />
          ))}

        {/* Previous iterations' thinking (collapsed, not actively thinking) */}
        {isLoading && previousIterations.map((content, index) => (
          <ThinkingWidget
            key={`prev-${index}`}
            streamingContent={content}
            isThinking={false}
          />
        ))}

        {/* Current iteration's thinking - actively streaming */}
        {isLoading && streamingContent && (
          <ThinkingWidget
            key="current-thinking"
            streamingContent={streamingContent}
            isThinking={true}
          />
        )}

        {/* Accumulated tool calls - only show consult_boss messages */}
        {isLoading && streamingToolCalls.length > 0 && (
          <div className="space-y-2">
            {streamingToolCalls.map(toolCall => {
              // consult_boss: Show as chat bubble when complete
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

              // All other tools: Hidden from user (only consult_boss is visible)
              // This includes: update_tasks, ask_user, request_task_approval,
              // read_file, list_directory, search_files, edit_file, etc.
              return null
            })}

            {/* Show compact "Working..." indicator when tools are executing */}
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

      {/* Debug panel trigger */}
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
