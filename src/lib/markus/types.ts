/**
 * Markus Frontend Types
 *
 * TypeScript interfaces for the Markus AI agent feature in the renderer process.
 * These mirror the types from electron/preload.ts for use in React components.
 */

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

export interface MarkusConversation {
  id: string
  title: string
  filebarId: string
  messages: MarkusChatMessage[]
  createdAt: number
  updatedAt: number
}

export interface MarkusChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  toolCalls?: MarkusToolCallRecord[]
  isPlan?: boolean
  status: 'pending' | 'streaming' | 'complete' | 'error'
  error?: string
}

export interface MarkusToolCallRecord {
  id: string
  name: string
  arguments: Record<string, unknown>
  status: 'pending' | 'approved' | 'rejected' | 'executing' | 'complete' | 'error'
  result?: unknown
  error?: string
  startedAt: number
  completedAt?: number
}

export interface MarkusConversationListItem {
  id: string
  title: string
  updatedAt: number
  messageCount: number
}

export interface MarkusMemoryProposal {
  id: string
  scope: 'system' | 'project'
  currentContent: string
  proposedContent: string
  diff: string
}
