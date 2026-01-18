import chokidar, { FSWatcher } from 'chokidar'
import fs from 'fs/promises'
import { BrowserWindow } from 'electron'

let watcher: FSWatcher | null = null
let currentPath: string | null = null

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
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      window.webContents.send('file:externalChange', { content })
    } catch (error) {
      console.error('Error reading changed file:', error)
    }
  })
}

export function stopFileWatcher() {
  if (watcher) {
    watcher.close()
    watcher = null
    currentPath = null
  }
}
