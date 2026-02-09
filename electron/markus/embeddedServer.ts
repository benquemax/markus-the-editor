/**
 * Embedded Server Lifecycle Manager
 *
 * Manages the Markus server lifecycle within the Electron main process.
 * On startup, checks if a server is already running (e.g. started manually
 * for development). If not, dynamically imports the pre-built server bundle
 * and starts it in-process.
 *
 * This avoids requiring users to manually start the server before launching
 * the Electron app, while still supporting external server usage for development.
 */

import path from 'path'
import http from 'http'

const DEFAULT_PORT = 3847

// MarkusServer interface matches the export from server.ts
interface MarkusServer {
  start(): Promise<void>
  stop(): Promise<void>
}

// Track whether we started the server ourselves (vs reusing an external one)
let embeddedServer: MarkusServer | null = null
let isExternalServer = false

/**
 * Check if a server is already listening on the given port.
 * Makes a GET request to /health and expects a 200 response.
 */
function checkServerHealth(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/health`, (res) => {
      resolve(res.statusCode === 200)
      // Consume response data to free up memory
      res.resume()
    })

    req.on('error', () => resolve(false))
    req.setTimeout(2000, () => {
      req.destroy()
      resolve(false)
    })
  })
}

/**
 * Starts the embedded Markus server, or reuses an existing external one.
 *
 * 1. Probes localhost:3847 — if a server responds, reuses it
 * 2. Otherwise, dynamically imports the pre-built server bundle and starts it
 *
 * Returns the port the server is running on.
 */
export async function startEmbeddedServer(): Promise<number> {
  // Check if server is already running (e.g. started manually for development)
  const alreadyRunning = await checkServerHealth(DEFAULT_PORT)
  if (alreadyRunning) {
    console.log(`[EmbeddedServer] Server already running on port ${DEFAULT_PORT}, reusing it`)
    isExternalServer = true
    return DEFAULT_PORT
  }

  // Dynamically import the pre-built server bundle
  // Uses path.join(__dirname, ...) so vite doesn't try to analyze/bundle it
  const bundlePath = path.join(__dirname, 'markus-server.mjs')
  console.log(`[EmbeddedServer] Starting embedded server from ${bundlePath}`)

  const serverModule = await import(/* @vite-ignore */ bundlePath)
  const server: MarkusServer = serverModule.createMarkusServer({ port: DEFAULT_PORT })

  await server.start()
  embeddedServer = server
  isExternalServer = false

  console.log(`[EmbeddedServer] Server started on port ${DEFAULT_PORT}`)
  return DEFAULT_PORT
}

/**
 * Stops the embedded server if we started it ourselves.
 * Does nothing if we're reusing an external server.
 */
export async function stopEmbeddedServer(): Promise<void> {
  if (isExternalServer) {
    console.log('[EmbeddedServer] Using external server, skipping shutdown')
    return
  }

  if (embeddedServer) {
    console.log('[EmbeddedServer] Stopping embedded server...')
    await embeddedServer.stop()
    embeddedServer = null
    console.log('[EmbeddedServer] Server stopped')
  }
}

/**
 * Returns the port the Markus server is running on.
 */
export function getServerPort(): number {
  return DEFAULT_PORT
}
