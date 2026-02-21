/**
 * Centralized Logging System
 *
 * Captures main process and renderer process logs into timestamped files
 * under a single `logs/` directory in the project root (dev) or the
 * platform config directory (production). Both processes write to the
 * same session log file, prefixed with [main] or [renderer] tags.
 *
 * During development, this means you can `tail -f logs/markus-*.log`
 * instead of scrolling through interleaved terminal output.
 *
 * Log files are auto-rotated: files older than 7 days are cleaned up
 * on startup to prevent unbounded growth.
 */

import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { app, IpcMain } from 'electron'

const LOG_RETENTION_DAYS = 7
const MAX_LOG_SIZE = 10 * 1024 * 1024 // 10 MB per file

let logFilePath: string | null = null
let logStream: fs.WriteStream | null = null

/**
 * Returns the logs directory path.
 * Dev: <project>/logs/
 * Production: ~/.config/markus-the-editor/logs/
 */
function getLogDir(): string {
  if (process.env.VITE_DEV_SERVER_URL) {
    // Development — use project-relative logs dir
    return path.join(process.cwd(), 'logs')
  }
  // Production — use platform config dir
  const configDir = process.env.XDG_CONFIG_HOME || path.join(app.getPath('home'), '.config')
  return path.join(configDir, 'markus-the-editor', 'logs')
}

/**
 * Initializes the logging system. Creates the log directory and opens
 * a write stream for the current session. Call this once from main.ts
 * before creating the window.
 */
export async function initLogger(): Promise<void> {
  const logDir = getLogDir()
  await fsp.mkdir(logDir, { recursive: true })

  // Session log file named with ISO date for easy sorting
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  logFilePath = path.join(logDir, `markus-${timestamp}.log`)
  logStream = fs.createWriteStream(logFilePath, { flags: 'a' })

  // Intercept console methods so existing console.log/warn/error calls
  // throughout the codebase also get written to the log file
  interceptConsole()

  // Clean up old log files in the background
  cleanOldLogs(logDir).catch(() => { /* ignore cleanup errors */ })

  log('main', 'info', `Logger initialized — writing to ${logFilePath}`)
  log('main', 'info', `Markus v${app.getVersion()}, Electron ${process.versions.electron}, Node ${process.versions.node}`)
}

/**
 * Writes a log entry to the session log file.
 */
export function log(source: 'main' | 'renderer', level: 'info' | 'warn' | 'error', message: string): void {
  if (!logStream) return

  const time = new Date().toISOString().slice(11, 23) // HH:MM:SS.mmm
  const line = `${time} [${source}] ${level.toUpperCase().padEnd(5)} ${message}\n`

  logStream.write(line)

  // Rotate if the file gets too large
  if (logFilePath) {
    try {
      const stats = fs.statSync(logFilePath)
      if (stats.size > MAX_LOG_SIZE) {
        rotateLog()
      }
    } catch {
      // stat failed, skip rotation check
    }
  }
}

/**
 * Rotates the current log file by closing the stream, renaming with
 * a .1 suffix, and opening a fresh file.
 */
function rotateLog(): void {
  if (!logStream || !logFilePath) return

  logStream.end()
  const rotatedPath = logFilePath.replace('.log', '.1.log')
  try {
    fs.renameSync(logFilePath, rotatedPath)
  } catch {
    // Ignore rename errors
  }
  logStream = fs.createWriteStream(logFilePath, { flags: 'a' })
}

/**
 * Replaces console.log/warn/error with versions that write to both
 * the terminal (original behavior) and the log file.
 */
function interceptConsole(): void {
  const originalLog = console.log
  const originalWarn = console.warn
  const originalError = console.error

  console.log = (...args: unknown[]) => {
    originalLog.apply(console, args)
    log('main', 'info', formatArgs(args))
  }

  console.warn = (...args: unknown[]) => {
    originalWarn.apply(console, args)
    log('main', 'warn', formatArgs(args))
  }

  console.error = (...args: unknown[]) => {
    originalError.apply(console, args)
    log('main', 'error', formatArgs(args))
  }
}

function formatArgs(args: unknown[]): string {
  return args.map(a => {
    if (typeof a === 'string') return a
    // Error objects serialize to {} with JSON.stringify — use stack/message instead
    if (a instanceof Error) return a.stack || a.message
    try { return JSON.stringify(a) } catch { return String(a) }
  }).join(' ')
}

/**
 * Removes log files older than LOG_RETENTION_DAYS.
 */
async function cleanOldLogs(logDir: string): Promise<void> {
  const files = await fsp.readdir(logDir)
  const now = Date.now()
  const maxAge = LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000

  for (const file of files) {
    if (!file.startsWith('markus-') || !file.endsWith('.log')) continue
    const filePath = path.join(logDir, file)
    try {
      const stats = await fsp.stat(filePath)
      if (now - stats.mtimeMs > maxAge) {
        await fsp.unlink(filePath)
      }
    } catch {
      // Ignore individual file cleanup errors
    }
  }
}

/**
 * Captures uncaught exceptions and unhandled rejections in the main process.
 * Call once during setup.
 */
export function captureProcessErrors(): void {
  process.on('uncaughtException', (error) => {
    log('main', 'error', `Uncaught exception: ${error.stack || error.message}`)
  })

  process.on('unhandledRejection', (reason) => {
    log('main', 'error', `Unhandled rejection: ${reason instanceof Error ? reason.stack || reason.message : String(reason)}`)
  })
}

/**
 * Registers IPC handlers so the renderer process can send logs to the
 * same log file. Call once from main.ts.
 */
export function setupLoggerHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('logger:log', (_, level: string, message: string) => {
    const validLevel = (['info', 'warn', 'error'] as const).includes(level as 'info' | 'warn' | 'error')
      ? level as 'info' | 'warn' | 'error'
      : 'info'
    log('renderer', validLevel, message)
  })

  ipcMain.handle('logger:getLogPath', () => logFilePath)
}

/**
 * Closes the log stream. Call during app shutdown.
 */
export function closeLogger(): void {
  if (logStream) {
    log('main', 'info', 'Logger shutting down')
    logStream.end()
    logStream = null
  }
}
