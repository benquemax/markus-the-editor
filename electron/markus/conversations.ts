/**
 * Markus Conversation Manager
 *
 * Handles persistence of chat conversations. Conversations are stored
 * per-filebar in the config directory to keep related chats together.
 */

import path from 'path'
import fs from 'fs/promises'
import { existsSync } from 'fs'
import { v4 as uuidv4 } from 'uuid'
import { Conversation, ChatMessage, ConversationListItem } from './types'
import { getConfigDir } from './settings'

/**
 * Gets the conversations directory for a specific filebar.
 */
function getConversationsDir(filebarId: string): string {
  return path.join(getConfigDir(), 'filebars', filebarId, 'conversations')
}

/**
 * Ensures the conversations directory exists.
 */
async function ensureConversationsDir(filebarId: string): Promise<string> {
  const dir = getConversationsDir(filebarId)
  await fs.mkdir(dir, { recursive: true })
  return dir
}

/**
 * Generates a title from the first user message.
 */
function generateTitle(messages: ChatMessage[]): string {
  const firstUserMessage = messages.find(m => m.role === 'user')
  if (!firstUserMessage) {
    return 'New Conversation'
  }

  // Take first 50 characters of the message
  const content = firstUserMessage.content.trim()
  if (content.length <= 50) {
    return content
  }

  return content.substring(0, 47) + '...'
}

/**
 * Creates a new conversation.
 */
export async function createConversation(filebarId: string): Promise<Conversation> {
  const now = Date.now()
  const conversation: Conversation = {
    id: uuidv4(),
    title: 'New Conversation',
    filebarId,
    messages: [],
    createdAt: now,
    updatedAt: now
  }

  await saveConversation(conversation)
  return conversation
}

/**
 * Saves a conversation to disk.
 */
export async function saveConversation(conversation: Conversation): Promise<void> {
  const dir = await ensureConversationsDir(conversation.filebarId)
  const filePath = path.join(dir, `${conversation.id}.json`)

  // Update title if needed
  if (conversation.messages.length > 0 && conversation.title === 'New Conversation') {
    conversation.title = generateTitle(conversation.messages)
  }

  conversation.updatedAt = Date.now()

  await fs.writeFile(filePath, JSON.stringify(conversation, null, 2), 'utf-8')
}

/**
 * Loads a conversation by ID.
 */
export async function loadConversation(
  filebarId: string,
  conversationId: string
): Promise<Conversation | null> {
  const dir = getConversationsDir(filebarId)
  const filePath = path.join(dir, `${conversationId}.json`)

  if (!existsSync(filePath)) {
    return null
  }

  try {
    const content = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(content) as Conversation
  } catch (error) {
    console.error('Failed to load conversation:', error)
    return null
  }
}

/**
 * Loads the most recent conversation for a filebar.
 */
export async function loadLatestConversation(filebarId: string): Promise<Conversation | null> {
  const conversations = await listConversations(filebarId)

  if (conversations.length === 0) {
    return null
  }

  // Get the most recently updated conversation
  const latest = conversations.sort((a, b) => b.updatedAt - a.updatedAt)[0]
  return loadConversation(filebarId, latest.id)
}

/**
 * Lists all conversations for a filebar.
 */
export async function listConversations(filebarId: string): Promise<ConversationListItem[]> {
  const dir = getConversationsDir(filebarId)

  if (!existsSync(dir)) {
    return []
  }

  try {
    const files = await fs.readdir(dir)
    const conversations: ConversationListItem[] = []

    for (const file of files) {
      if (!file.endsWith('.json')) continue

      try {
        const content = await fs.readFile(path.join(dir, file), 'utf-8')
        const conv = JSON.parse(content) as Conversation

        conversations.push({
          id: conv.id,
          title: conv.title,
          updatedAt: conv.updatedAt,
          messageCount: conv.messages.length
        })
      } catch {
        // Skip invalid files
      }
    }

    // Sort by most recent first
    return conversations.sort((a, b) => b.updatedAt - a.updatedAt)
  } catch (error) {
    console.error('Failed to list conversations:', error)
    return []
  }
}

/**
 * Deletes a conversation.
 */
export async function deleteConversation(
  filebarId: string,
  conversationId: string
): Promise<boolean> {
  const dir = getConversationsDir(filebarId)
  const filePath = path.join(dir, `${conversationId}.json`)

  if (!existsSync(filePath)) {
    return false
  }

  try {
    await fs.unlink(filePath)
    return true
  } catch (error) {
    console.error('Failed to delete conversation:', error)
    return false
  }
}

/**
 * Adds a message to a conversation.
 */
export async function addMessage(
  conversation: Conversation,
  message: Omit<ChatMessage, 'id' | 'timestamp'>
): Promise<ChatMessage> {
  const fullMessage: ChatMessage = {
    ...message,
    id: uuidv4(),
    timestamp: Date.now()
  }

  conversation.messages.push(fullMessage)
  await saveConversation(conversation)

  return fullMessage
}

/**
 * Updates a message in a conversation.
 */
export async function updateMessage(
  conversation: Conversation,
  messageId: string,
  updates: Partial<ChatMessage>
): Promise<void> {
  const index = conversation.messages.findIndex(m => m.id === messageId)
  if (index === -1) return

  conversation.messages[index] = {
    ...conversation.messages[index],
    ...updates
  }

  await saveConversation(conversation)
}

/**
 * Gets a hash of filebar folders to use as a filebar ID.
 * This ensures conversations are grouped by workspace configuration.
 */
export function getFilebarId(folders: string[]): string {
  if (folders.length === 0) {
    return 'default'
  }

  // Create a simple hash from folder paths
  const sortedFolders = [...folders].sort()
  const combined = sortedFolders.join('|')

  // Simple hash function
  let hash = 0
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }

  return Math.abs(hash).toString(16)
}

/**
 * Cleans up old conversations (optional).
 */
export async function cleanupOldConversations(
  filebarId: string,
  maxAge: number = 30 * 24 * 60 * 60 * 1000 // 30 days
): Promise<number> {
  const conversations = await listConversations(filebarId)
  const now = Date.now()
  let deleted = 0

  for (const conv of conversations) {
    if (now - conv.updatedAt > maxAge) {
      const success = await deleteConversation(filebarId, conv.id)
      if (success) deleted++
    }
  }

  return deleted
}
