/**
 * ConversationDebugPanel Component
 *
 * Provides a debug view of the raw conversation data.
 * Useful for developers to understand what's happening under the hood.
 */

import { useState } from 'react'
import { Bug, Copy, Check, X, MessageSquare, Code, BarChart3 } from 'lucide-react'
import type { MarkusConversation, MarkusChatMessage } from '../../lib/markus/types'
import { cn } from '../../lib/utils'

interface ConversationDebugPanelProps {
  conversation: MarkusConversation | null
}

/**
 * Single message debug view.
 */
function MessageDebugView({ message, index }: { message: MarkusChatMessage; index: number }) {
  const [expanded, setExpanded] = useState(false)

  const roleColors = {
    user: 'bg-blue-500/10 border-blue-500/30',
    assistant: 'bg-green-500/10 border-green-500/30',
    system: 'bg-purple-500/10 border-purple-500/30'
  }

  return (
    <div className={cn('border rounded p-2 text-xs', roleColors[message.role])}>
      <div
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <span className="font-mono text-muted-foreground">#{index}</span>
          <span className="font-semibold capitalize">{message.role}</span>
          <span className="text-muted-foreground">
            {message.status}
          </span>
          {message.toolCalls && message.toolCalls.length > 0 && (
            <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-600 rounded text-[10px]">
              {message.toolCalls.length} tool calls
            </span>
          )}
        </div>
        <span className="text-muted-foreground">
          {new Date(message.timestamp).toLocaleTimeString()}
        </span>
      </div>

      {expanded && (
        <div className="mt-2 space-y-2">
          <div>
            <div className="font-medium text-muted-foreground mb-1">Content:</div>
            <pre className="bg-black/10 p-2 rounded whitespace-pre-wrap max-h-[200px] overflow-auto thin-scrollbar">
              {message.content || '(empty)'}
            </pre>
          </div>

          {message.toolCalls && message.toolCalls.length > 0 && (
            <div>
              <div className="font-medium text-muted-foreground mb-1">Tool Calls:</div>
              <pre className="bg-black/10 p-2 rounded whitespace-pre-wrap max-h-[200px] overflow-auto thin-scrollbar">
                {JSON.stringify(message.toolCalls, null, 2)}
              </pre>
            </div>
          )}

          {message.error && (
            <div className="text-red-500">
              Error: {message.error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Token usage estimate.
 */
function TokenUsageDisplay({ conversation }: { conversation: MarkusConversation }) {
  // Rough token estimation (4 chars per token)
  const estimateTokens = (text: string) => Math.ceil(text.length / 4)

  const tokensByRole = conversation.messages.reduce((acc, msg) => {
    const tokens = estimateTokens(msg.content)
    acc[msg.role] = (acc[msg.role] || 0) + tokens
    return acc
  }, {} as Record<string, number>)

  const total = Object.values(tokensByRole).reduce((a, b) => a + b, 0)

  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center justify-between">
        <span>Total estimated tokens:</span>
        <span className="font-mono font-bold">{total.toLocaleString()}</span>
      </div>

      <div className="space-y-1">
        {Object.entries(tokensByRole).map(([role, tokens]) => (
          <div key={role} className="flex items-center justify-between">
            <span className="capitalize">{role}:</span>
            <div className="flex items-center gap-2">
              <div
                className="h-2 bg-primary/50 rounded"
                style={{ width: `${Math.max(4, (tokens / total) * 100)}px` }}
              />
              <span className="font-mono">{tokens.toLocaleString()}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between text-muted-foreground">
        <span>Message count:</span>
        <span className="font-mono">{conversation.messages.length}</span>
      </div>
    </div>
  )
}

export function ConversationDebugPanel({ conversation }: ConversationDebugPanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [activeTab, setActiveTab] = useState<'messages' | 'raw' | 'tokens'>('messages')

  const handleCopy = async () => {
    if (!conversation) return
    await navigator.clipboard.writeText(JSON.stringify(conversation, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!conversation) return null

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        title="Debug conversation"
      >
        <Bug className="w-3.5 h-3.5" />
        Debug
      </button>

      {/* Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background border rounded-lg shadow-lg w-full max-w-4xl max-h-[80vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div className="flex items-center gap-2">
                <Bug className="w-4 h-4" />
                <span className="font-semibold">Conversation Debug View</span>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 hover:bg-muted rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b">
              <button
                onClick={() => setActiveTab('messages')}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2 text-sm border-b-2',
                  activeTab === 'messages'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                <MessageSquare className="w-4 h-4" />
                Messages
              </button>
              <button
                onClick={() => setActiveTab('raw')}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2 text-sm border-b-2',
                  activeTab === 'raw'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                <Code className="w-4 h-4" />
                Raw JSON
              </button>
              <button
                onClick={() => setActiveTab('tokens')}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2 text-sm border-b-2',
                  activeTab === 'tokens'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                <BarChart3 className="w-4 h-4" />
                Token Usage
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto thin-scrollbar p-4">
              {activeTab === 'messages' && (
                <div className="space-y-2">
                  {conversation.messages.map((msg, i) => (
                    <MessageDebugView key={msg.id} message={msg} index={i} />
                  ))}
                </div>
              )}

              {activeTab === 'raw' && (
                <pre className="text-xs font-mono bg-muted p-4 rounded overflow-auto thin-scrollbar max-h-[60vh]">
                  {JSON.stringify(conversation, null, 2)}
                </pre>
              )}

              {activeTab === 'tokens' && (
                <TokenUsageDisplay conversation={conversation} />
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/30">
              <div className="text-xs text-muted-foreground">
                ID: {conversation.id}
              </div>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    Copy JSON
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
