/**
 * Markus Server
 *
 * Standalone API server for the Markus AI agent.
 * Provides HTTP and WebSocket APIs for conversation management
 * and AI-powered editing assistance.
 *
 * Usage:
 *   npx markus-server
 *   MARKUS_PORT=3000 npx markus-server
 */

import { createMarkusServer, type MarkusServer } from './server'
import { getConfig, type ServerConfig } from './config'
import { ConversationManager } from './conversationManager'

export { createMarkusServer, type MarkusServer }
export { getConfig, type ServerConfig }
export { ConversationManager }
export * from './types'

/**
 * Starts the server when run directly.
 */
export async function startServer(): Promise<void> {
  const server = createMarkusServer()

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n[Markus Server] Shutting down...')
    await server.stop()
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    console.log('\n[Markus Server] Shutting down...')
    await server.stop()
    process.exit(0)
  })

  await server.start()
}

// Auto-start when run directly
startServer().catch(err => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
