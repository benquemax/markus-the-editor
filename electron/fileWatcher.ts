import chokidar, { FSWatcher } from 'chokidar'
import fs from 'fs/promises'
import { BrowserWindow } from 'electron'

let watcher: FSWatcher | null = null
let currentPath: string | null = null

// Timestamp of the last internal save — used to suppress the spurious
// change event that fires when the watcher restarts right after a write
let lastSaveTimestamp = 0
const SAVE_SUPPRESS_MS = 1000

export function setupFileWatcher(filePath: string, window: BrowserWindow) {
  // Stop existing watcher if watching a different file
  if (watcher && currentPath !== filePath) {
    stopFileWatcher()
  }

  currentPath = filePath

  // Create new watcher
  watcher = chokidar.watch(filePath, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100
    }
  })

  watcher.on('change', async () => {
    // Suppress change events that arrive shortly after an internal save
    if (Date.now() - lastSaveTimestamp < SAVE_SUPPRESS_MS) return

    try {
      const content = await fs.readFile(filePath, 'utf-8')
      window.webContents.send('file:externalChange', { content })
    } catch (error) {
      console.error('Error reading changed file:', error)
    }
  })
}

/**
 * Marks the current time as an internal save, so the file watcher
 * ignores the resulting filesystem change event.
 */
export function markInternalSave() {
  lastSaveTimestamp = Date.now()
}

export function stopFileWatcher() {
  if (watcher) {
    watcher.close()
    watcher = null
    currentPath = null
  }
}
