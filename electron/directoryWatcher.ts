/**
 * Directory Watcher
 *
 * Watches a directory recursively for changes and notifies the renderer process.
 * Uses chokidar for efficient cross-platform file watching.
 * Debounces change events to avoid overwhelming the renderer with rapid updates.
 */

import chokidar, { FSWatcher } from 'chokidar'
import { BrowserWindow, IpcMain } from 'electron'

let watcher: FSWatcher | null = null
let currentPath: string | null = null
let debounceTimer: NodeJS.Timeout | null = null

const DEBOUNCE_DELAY = 300

/**
 * Starts watching a directory for changes.
 * Only one directory can be watched at a time.
 */
export function watchDirectory(dirPath: string, window: BrowserWindow) {
  // Stop existing watcher if watching a different directory
  if (watcher && currentPath !== dirPath) {
    stopDirectoryWatcher()
  }

  // Already watching this directory
  if (currentPath === dirPath && watcher) {
    return
  }

  currentPath = dirPath

  watcher = chokidar.watch(dirPath, {
    persistent: true,
    ignoreInitial: true,
    // Ignore hidden files, node_modules, and .git
    ignored: [
      /(^|[/\\])\../,
      '**/node_modules/**',
      '**/.git/**'
    ],
    // Wait for files to be fully written before emitting
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 100
    },
    // Don't watch too deep to avoid performance issues
    depth: 10
  })

  const notifyChange = () => {
    // Debounce to batch rapid changes
    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }

    debounceTimer = setTimeout(() => {
      if (window && !window.isDestroyed()) {
        window.webContents.send('explorer:directoryChanged')
      }
      debounceTimer = null
    }, DEBOUNCE_DELAY)
  }

  watcher.on('add', notifyChange)
  watcher.on('unlink', notifyChange)
  watcher.on('addDir', notifyChange)
  watcher.on('unlinkDir', notifyChange)
  // Note: We don't watch for 'change' (file content changes) as it would be too noisy
  // and the file explorer only cares about structure changes
}

/**
 * Stops watching the current directory.
 */
export function stopDirectoryWatcher() {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }

  if (watcher) {
    watcher.close()
    watcher = null
    currentPath = null
  }
}

/**
 * Sets up IPC handlers for directory watching.
 */
export function setupDirectoryWatcherHandlers(ipcMain: IpcMain, getMainWindow: () => BrowserWindow | null) {
  ipcMain.handle('explorer:watchDirectory', async (_, dirPath: string) => {
    const mainWindow = getMainWindow()
    if (!mainWindow) return { success: false, error: 'No window' }

    watchDirectory(dirPath, mainWindow)
    return { success: true }
  })

  ipcMain.handle('explorer:unwatchDirectory', async () => {
    stopDirectoryWatcher()
    return { success: true }
  })
}
