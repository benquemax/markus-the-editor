/**
 * MarkusPanel Component
 *
 * Main container for the Markus AI agent interface.
 * Displays chat messages, handles conversation management,
 * and provides controls for planning/YOLO modes.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { Settings, AlertCircle } from 'lucide-react'
import { ConversationHeader } from './ConversationHeader'
import { ChatMessage } from './ChatMessage'
import { ChatInput } from './ChatInput'
import type {
  MarkusConversation,
  MarkusToolCallRecord,
  MarkusSettings
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
  const [streamingContent, setStreamingContent] = useState('')
  const [planningMode, setPlanningMode] = useState(true)
  const [yoloMode, setYoloMode] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Scroll to bottom when messages change
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
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

  // Subscribe to streaming events
  useEffect(() => {
    const unsubChunk = window.electron.markus.onMessageChunk((data: { conversationId: string; chunk: string }) => {
      if (data.conversationId === conversation?.id) {
        setStreamingContent(prev => prev + data.chunk)
        scrollToBottom()
      }
    })

    const unsubToolStart = window.electron.markus.onToolCallStarted((data: { conversationId: string; toolCall: MarkusToolCallRecord }) => {
      if (data.conversationId === conversation?.id) {
        setConversation((prev: MarkusConversation | null) => {
          if (!prev) return prev
          const messages = [...prev.messages]
          const lastMsg = messages[messages.length - 1]
          if (lastMsg?.role === 'assistant') {
            // Check if tool call already exists to prevent duplicates
            const existingIds = new Set((lastMsg.toolCalls || []).map(tc => tc.id))
            if (!existingIds.has(data.toolCall.id)) {
              lastMsg.toolCalls = [...(lastMsg.toolCalls || []), data.toolCall]
            }
          }
          return { ...prev, messages }
        })
      }
    })

    const unsubToolComplete = window.electron.markus.onToolCallComplete((data: { conversationId: string; toolCallId: string; result: unknown }) => {
      if (data.conversationId === conversation?.id) {
        setConversation((prev: MarkusConversation | null) => {
          if (!prev) return prev
          const messages = [...prev.messages]
          const lastMsg = messages[messages.length - 1]
          if (lastMsg?.role === 'assistant' && lastMsg.toolCalls) {
            const toolCall = lastMsg.toolCalls.find((tc: MarkusToolCallRecord) => tc.id === data.toolCallId)
            if (toolCall) {
              toolCall.status = 'complete'
              toolCall.result = data.result
            }
          }
          return { ...prev, messages }
        })
      }
    })

    const unsubComplete = window.electron.markus.onRequestComplete((data: { conversationId: string; messageId: string }) => {
      if (data.conversationId === conversation?.id) {
        setIsLoading(false)
        setStreamingContent('')
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

  // Handle tool approval
  const handleToolApproval = useCallback(async (toolCallId: string, approved: boolean) => {
    if (!conversation) return

    await window.electron.markus.approveTool({
      conversationId: conversation.id,
      toolCallId,
      approved
    })
  }, [conversation])

  // Handle opening settings
  const handleOpenSettings = useCallback(async () => {
    await window.electron.markus.openSettings()
  }, [])

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

      {/* Messages */}
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {conversation?.messages
          // Filter out the streaming placeholder message to avoid showing it twice
          // (once from conversation.messages, once from streamingContent below)
          .filter((message) => !(isLoading && message.status === 'streaming'))
          // Filter out internal "[Tool Results]" messages - these are for LLM context only
          .filter((message) => !message.content.startsWith('[Tool Results]'))
          .map((message) => (
            <ChatMessage
              key={message.id}
              message={message}
              onToolApproval={handleToolApproval}
            />
          ))}

        {/* Streaming message - includes tool calls from the actual message */}
        {isLoading && (
          <ChatMessage
            message={{
              id: 'streaming',
              role: 'assistant',
              content: streamingContent,
              timestamp: Date.now(),
              status: 'streaming',
              // Include tool calls from the actual streaming message
              toolCalls: conversation?.messages.find(m => m.status === 'streaming')?.toolCalls
            }}
            onToolApproval={handleToolApproval}
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
