/**
 * Markus Server
 *
 * Express server setup for the Markus AI agent API.
 * Provides HTTP endpoints for conversation management and
 * WebSocket support for streaming chat interactions.
 */

import express, { Express, Request, Response, NextFunction } from 'express'
import { createServer as createHttpServer, Server as HttpServer } from 'http'
import { WebSocketServer } from 'ws'
import { getConfig, ServerConfig } from './config'
import { setupConversationRoutes } from './routes/conversations'
import { setupSettingsRoutes } from './routes/settings'
import { setupAgentRoutes } from './routes/agents'
import { setupWebSocketHandler } from './websocket/handler'
import { ConversationManager } from './conversationManager'

export interface MarkusServer {
  app: Express
  httpServer: HttpServer
  wss: WebSocketServer
  conversationManager: ConversationManager
  start(): Promise<void>
  stop(): Promise<void>
}

/**
 * Creates and configures the Markus server.
 */
export function createMarkusServer(config?: Partial<ServerConfig>): MarkusServer {
  const serverConfig = { ...getConfig(), ...config }

  const app = express()
  const httpServer = createHttpServer(app)

  // Create WebSocket server attached to HTTP server
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws'
  })

  // Create conversation manager
  const conversationManager = new ConversationManager()

  // Middleware
  app.use(express.json())

  // CORS middleware - permissive for local development
  // Electron apps may use file:// or custom protocols
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin

    // Allow all localhost origins and Electron file:// protocol
    const isLocalhost = !origin ||
      origin.startsWith('http://localhost') ||
      origin.startsWith('http://127.0.0.1') ||
      origin.startsWith('file://') ||
      serverConfig.corsOrigins.includes(origin)

    if (isLocalhost) {
      res.setHeader('Access-Control-Allow-Origin', origin || '*')
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.setHeader('Access-Control-Allow-Credentials', 'true')

    if (req.method === 'OPTIONS') {
      res.status(204).end()
      return
    }

    next()
  })

  // Request logging (debug mode)
  if (serverConfig.debug) {
    app.use((req: Request, _res: Response, next: NextFunction) => {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`)
      next()
    })
  }

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      version: '0.1.0',
      uptime: process.uptime()
    })
  })

  // Setup routes
  setupConversationRoutes(app, conversationManager)
  setupSettingsRoutes(app)
  setupAgentRoutes(app)

  // Setup WebSocket handler
  setupWebSocketHandler(wss, conversationManager)

  // Error handling middleware
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[Server] Error:', err)
    res.status(500).json({
      error: 'Internal server error',
      message: serverConfig.debug ? err.message : undefined
    })
  })

  // 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' })
  })

  return {
    app,
    httpServer,
    wss,
    conversationManager,

    start(): Promise<void> {
      return new Promise((resolve, reject) => {
        httpServer.listen(serverConfig.port, serverConfig.host, () => {
          console.log(`[Markus Server] Listening on http://${serverConfig.host}:${serverConfig.port}`)
          console.log(`[Markus Server] WebSocket available at ws://${serverConfig.host}:${serverConfig.port}/ws`)
          resolve()
        })

        httpServer.on('error', reject)
      })
    },

    stop(): Promise<void> {
      return new Promise((resolve, reject) => {
        // Close WebSocket connections
        wss.clients.forEach(client => {
          client.close(1001, 'Server shutting down')
        })

        wss.close(err => {
          if (err) {
            console.error('[Markus Server] Error closing WebSocket server:', err)
          }

          httpServer.close(err => {
            if (err) {
              reject(err)
            } else {
              console.log('[Markus Server] Stopped')
              resolve()
            }
          })
        })
      })
    }
  }
}
