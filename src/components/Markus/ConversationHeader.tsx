/**
 * ConversationHeader Component
 *
 * Header bar for the Markus panel showing the conversation title,
 * new chat button, history dropdown, and settings access.
 */

import { useState, useEffect, useCallback } from 'react'
import { Plus, History, Settings, ChevronDown, Trash2 } from 'lucide-react'
import type { MarkusConversation, MarkusConversationListItem } from '../../lib/markus/types'
import { cn } from '../../lib/utils'

interface ConversationHeaderProps {
  conversation: MarkusConversation | null
  onNewConversation: () => void
  onLoadConversation: (conversationId: string) => void
  onOpenSettings: () => void
}

export function ConversationHeader({
  conversation,
  onNewConversation,
  onLoadConversation,
  onOpenSettings
}: ConversationHeaderProps) {
  const [showHistory, setShowHistory] = useState(false)
  const [conversations, setConversations] = useState<MarkusConversationListItem[]>([])

  // Load conversation history when dropdown opens
  useEffect(() => {
    if (showHistory) {
      window.electron.markus.listConversations().then(setConversations)
    }
  }, [showHistory])

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!showHistory) return

    const handleClickOutside = () => setShowHistory(false)
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [showHistory])

  const handleDelete = useCallback(async (e: React.MouseEvent, conversationId: string) => {
    e.stopPropagation()

    const confirmed = await window.electron.dialog.showMessage({
      type: 'question',
      title: 'Delete Conversation',
      message: 'Are you sure you want to delete this conversation?',
      buttons: ['Delete', 'Cancel']
    })

    if (confirmed.response === 0) {
      await window.electron.markus.deleteConversation(conversationId)
      setConversations(prev => prev.filter(c => c.id !== conversationId))

      // If we deleted the current conversation, create a new one
      if (conversation?.id === conversationId) {
        onNewConversation()
      }
    }
  }, [conversation?.id, onNewConversation])

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))

    if (diffDays === 0) {
      return 'Today'
    } else if (diffDays === 1) {
      return 'Yesterday'
    } else if (diffDays < 7) {
      return date.toLocaleDateString(undefined, { weekday: 'long' })
    } else {
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    }
  }

  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-border">
      {/* Title and history dropdown */}
      <div className="relative">
        <button
          onClick={(e) => {
            e.stopPropagation()
            setShowHistory(!showHistory)
          }}
          className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
        >
          <span className="truncate max-w-[150px]">
            {conversation?.title || 'Markus'}
          </span>
          <ChevronDown className={cn(
            'w-3 h-3 transition-transform',
            showHistory && 'rotate-180'
          )} />
        </button>

        {/* History dropdown */}
        {showHistory && (
          <div
            className="absolute top-full left-0 mt-1 w-64 bg-popover border border-border rounded-lg shadow-lg z-50 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-2 border-b border-border">
              <button
                onClick={() => {
                  onNewConversation()
                  setShowHistory(false)
                }}
                className="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-accent"
              >
                <Plus className="w-4 h-4" />
                New Conversation
              </button>
            </div>

            <div className="max-h-[300px] overflow-auto thin-scrollbar">
              {conversations.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground text-center">
                  No conversations yet
                </div>
              ) : (
                conversations.map((conv) => (
                  <div
                    key={conv.id}
                    className={cn(
                      'group flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-accent',
                      conv.id === conversation?.id && 'bg-accent'
                    )}
                    onClick={() => {
                      onLoadConversation(conv.id)
                      setShowHistory(false)
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{conv.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(conv.updatedAt)} &middot; {conv.messageCount} messages
                      </div>
                    </div>
                    <button
                      onClick={(e) => handleDelete(e, conv.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/10 rounded transition-opacity"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={onNewConversation}
          className="p-1 hover:bg-accent rounded"
          title="New conversation"
        >
          <Plus className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            setShowHistory(!showHistory)
          }}
          className="p-1 hover:bg-accent rounded"
          title="Conversation history"
        >
          <History className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
        </button>
        <button
          onClick={onOpenSettings}
          className="p-1 hover:bg-accent rounded"
          title="Open settings"
        >
          <Settings className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
        </button>
      </div>
    </div>
  )
}
