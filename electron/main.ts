import { app, BrowserWindow, ipcMain, dialog, Menu, shell } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import { existsSync } from 'fs'
import { createMenu } from './menu'
import { setupFileWatcher, stopFileWatcher } from './fileWatcher'
import { setupGitHandlers } from './git'
import { setupAiHandlers } from './ai'
import { setupFileExplorerHandlers } from './fileExplorer'
import { setupDirectoryWatcherHandlers, stopDirectoryWatcher } from './directoryWatcher'
import Store from 'electron-store'

// Disable GPU acceleration if it causes issues on some Linux systems
app.disableHardwareAcceleration()

const store = new Store({
  defaults: {
    recentFiles: [] as string[],
    windowBounds: { width: 1200, height: 800 },
    theme: 'system' as 'light' | 'dark' | 'system',
    aiMerge: {
      enabled: false,
      apiEndpoint: 'https://api.openai.com/v1/chat/completions',
      apiKey: '',
      model: 'gpt-4o-mini'
    },
    explorerRootPath: null as string | null,
    showExplorer: true
  }
})

let mainWindow: BrowserWindow | null = null
let currentFilePath: string | null = null

const DIST = path.join(__dirname, '../dist')
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

/**
 * Dialog Helper Functions
 *
 * These helpers ensure dialogs are always shown with mainWindow as parent.
 *
 * Note: Electron 28 had a bug where dialogs appeared behind the window on Linux/GTK.
 * This was fixed in Electron 29+ via PR #42045:
 * - https://github.com/electron/electron/issues/32857
 * - https://github.com/electron/electron/pull/42045
 *
 * IMPORTANT: Always use these helpers instead of calling dialog.show* directly
 * to ensure consistent behavior and proper parent window attachment.
 */
async function showOpenDialog(options: Electron.OpenDialogOptions) {
  if (!mainWindow) return { canceled: true, filePaths: [] }
  return dialog.showOpenDialog(mainWindow, options)
}

async function showSaveDialog(options: Electron.SaveDialogOptions) {
  if (!mainWindow) return { canceled: true, filePath: undefined }
  return dialog.showSaveDialog(mainWindow, options)
}

async function showMessageBox(options: Electron.MessageBoxOptions) {
  if (!mainWindow) return { response: 0, checkboxChecked: false }
  return dialog.showMessageBox(mainWindow, options)
}

function createWindow() {
  const bounds = store.get('windowBounds') as { width: number; height: number }

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    title: 'Markus',
    show: false
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    // Only open DevTools when running from dev server, not in production builds
    if (VITE_DEV_SERVER_URL) {
      mainWindow?.webContents.openDevTools()
    }
  })

  mainWindow.on('resize', () => {
    if (mainWindow) {
      const [width, height] = mainWindow.getSize()
      store.set('windowBounds', { width, height })
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (VITE_DEV_SERVER_URL) {
    console.log('Loading from dev server:', VITE_DEV_SERVER_URL)
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
  } else {
    const indexPath = path.join(DIST, 'index.html')
    console.log('Loading from file:', indexPath)
    console.log('__dirname:', __dirname)
    console.log('DIST:', DIST)
    mainWindow.loadFile(indexPath)
  }

  const menu = createMenu(mainWindow, {
    onNewWindow: () => handleNewWindow(),
    onNewTab: () => handleNewTab(),
    onOpenFile: () => handleOpenFile(),
    onOpenFolder: () => handleOpenFolder(),
    onSaveFile: () => handleSaveFile(),
    onSaveAsFile: () => handleSaveAsFile(),
    onPrintToPdf: () => handlePrintToPdf(),
    getRecentFiles: () => store.get('recentFiles') as string[],
    onOpenRecentFile: (filePath: string) => openFile(filePath),
    onClearRecentFiles: () => store.set('recentFiles', [])
  })

  Menu.setApplicationMenu(menu)
}

/**
 * Creates a new Markus window.
 */
function handleNewWindow() {
  createWindow()
}

/**
 * Creates a new tab in the current window.
 */
function handleNewTab() {
  if (mainWindow) {
    currentFilePath = null
    mainWindow.setTitle('Markus - Untitled')
    mainWindow.webContents.send('file:new')
  }
}

/**
 * File type detection helpers
 */
const BINARY_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'mp4', 'webm', 'mov', 'avi', 'mkv', 'ogg']
const SUPPORTED_EXTENSIONS = ['md', 'markdown', 'json', 'html', 'htm', ...BINARY_EXTENSIONS]

function getFileExtension(filePath: string): string {
  const parts = filePath.split('.')
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : ''
}

function isBinaryFile(filePath: string): boolean {
  return BINARY_EXTENSIONS.includes(getFileExtension(filePath))
}

async function handleOpenFile() {
  const result = await showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown'] },
      { name: 'JSON', extensions: ['json'] },
      { name: 'HTML', extensions: ['html', 'htm'] },
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'] },
      { name: 'Videos', extensions: ['mp4', 'webm', 'mov'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  })

  if (!result.canceled && result.filePaths.length > 0) {
    await openFile(result.filePaths[0])
  }
}

async function handleOpenFolder() {
  if (!mainWindow) return

  const result = await showOpenDialog({
    properties: ['openDirectory']
  })

  if (!result.canceled && result.filePaths.length > 0) {
    const folderPath = result.filePaths[0]
    // Send the folder path to the renderer to open in explorer
    mainWindow.webContents.send('explorer:openFolder', { path: folderPath })
  }
}

async function openFile(filePath: string) {
  if (!mainWindow) return

  try {
    currentFilePath = filePath
    mainWindow.setTitle(`Markus - ${path.basename(filePath)}`)

    if (isBinaryFile(filePath)) {
      // Read binary files as base64
      const data = await fs.readFile(filePath)
      mainWindow.webContents.send('file:binaryOpened', { data: data.toString('base64'), filePath })
    } else {
      // Read text files as utf-8
      const content = await fs.readFile(filePath, 'utf-8')
      mainWindow.webContents.send('file:opened', { content, filePath })
      // Only watch text files for external changes
      setupFileWatcher(filePath, mainWindow)
    }

    addToRecentFiles(filePath)
  } catch (error) {
    dialog.showErrorBox('Error', `Failed to open file: ${error}`)
  }
}

async function handleSaveFile() {
  if (!mainWindow) return

  if (currentFilePath) {
    mainWindow.webContents.send('file:requestContent')
  } else {
    await handleSaveAsFile()
  }
}

async function handleSaveAsFile() {
  if (!mainWindow) return

  const result = await showSaveDialog({
    filters: [
      { name: 'Markdown', extensions: ['md'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    defaultPath: currentFilePath || 'untitled.md'
  })

  if (!result.canceled && result.filePath) {
    currentFilePath = result.filePath
    mainWindow.setTitle(`Markus - ${path.basename(result.filePath)}`)
    mainWindow.webContents.send('file:requestContent')
    addToRecentFiles(result.filePath)
    setupFileWatcher(result.filePath, mainWindow)
  }
}

async function handlePrintToPdf() {
  if (!mainWindow) return

  const result = await showSaveDialog({
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    defaultPath: currentFilePath
      ? currentFilePath.replace(/\.(md|markdown)$/i, '.pdf')
      : 'document.pdf'
  })

  if (!result.canceled && result.filePath) {
    try {
      const pdfData = await mainWindow.webContents.printToPDF({
        printBackground: true,
        margins: { top: 1, bottom: 1, left: 1, right: 1 }
      })
      await fs.writeFile(result.filePath, pdfData)
      shell.openPath(result.filePath)
    } catch (error) {
      dialog.showErrorBox('Error', `Failed to generate PDF: ${error}`)
    }
  }
}

function addToRecentFiles(filePath: string) {
  const recent = store.get('recentFiles') as string[]
  const filtered = recent.filter(f => f !== filePath)
  const updated = [filePath, ...filtered].slice(0, 10)
  store.set('recentFiles', updated)
}

// IPC Handlers
ipcMain.handle('file:save', async (_, content: string) => {
  if (!currentFilePath) return { success: false, error: 'No file path' }

  try {
    stopFileWatcher()
    await fs.writeFile(currentFilePath, content, 'utf-8')
    setupFileWatcher(currentFilePath, mainWindow!)
    return { success: true, filePath: currentFilePath }
  } catch (error) {
    return { success: false, error: String(error) }
  }
})

ipcMain.handle('file:open', async () => {
  await handleOpenFile()
})

ipcMain.handle('file:saveAs', async (_, content: string) => {
  if (!mainWindow) return { success: false, error: 'No window' }

  const result = await showSaveDialog({
    filters: [
      { name: 'Markdown', extensions: ['md'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    defaultPath: currentFilePath || 'untitled.md'
  })

  if (result.canceled || !result.filePath) {
    return { success: false, error: 'Cancelled' }
  }

  try {
    await fs.writeFile(result.filePath, content, 'utf-8')
    currentFilePath = result.filePath
    mainWindow.setTitle(`Markus - ${path.basename(result.filePath)}`)
    addToRecentFiles(result.filePath)
    setupFileWatcher(result.filePath, mainWindow)
    return { success: true, filePath: result.filePath }
  } catch (error) {
    return { success: false, error: String(error) }
  }
})

ipcMain.handle('file:getCurrentPath', () => currentFilePath)

// Read a binary file as base64
ipcMain.handle('file:readBinary', async (_, filePath: string) => {
  try {
    const data = await fs.readFile(filePath)
    return { success: true, data: data.toString('base64') }
  } catch (error) {
    return { success: false, error: String(error) }
  }
})

ipcMain.handle('dialog:showMessage', async (_, options: { type: string; title: string; message: string; buttons: string[] }) => {
  const result = await showMessageBox({
    type: options.type as 'none' | 'info' | 'error' | 'question' | 'warning',
    title: options.title,
    message: options.message,
    buttons: options.buttons
  })
  return { response: result.response }
})

ipcMain.handle('store:get', (_, key: string) => store.get(key))
ipcMain.handle('store:set', (_, key: string, value: unknown) => store.set(key, value))

ipcMain.handle('shell:openExternal', (_, url: string) => shell.openExternal(url))

// Set up git handlers
setupGitHandlers(ipcMain, () => currentFilePath)

// Set up AI merge handlers
setupAiHandlers(ipcMain, store)

// Set up file explorer handlers
setupFileExplorerHandlers(ipcMain, () => mainWindow)
setupDirectoryWatcherHandlers(ipcMain, () => mainWindow)

// Handle file dropped onto window
ipcMain.handle('file:openPath', async (_, filePath: string) => {
  if (existsSync(filePath)) {
    await openFile(filePath)
    return { success: true }
  }
  return { success: false, error: 'File not found' }
})

/**
 * Filebar Storage Handlers
 *
 * Filebars are saved in ~/.config/markus-the-editor/filebars/ following XDG Base Directory spec.
 * Each filebar is a JSON file containing an array of folder entries.
 */
function getFilebarDir(): string {
  const configDir = process.env.XDG_CONFIG_HOME || path.join(app.getPath('home'), '.config')
  return path.join(configDir, 'markus-the-editor', 'filebars')
}

async function ensureFilebarDir(): Promise<void> {
  const dir = getFilebarDir()
  await fs.mkdir(dir, { recursive: true })
}

ipcMain.handle('filebar:save', async (_, name: string, folders: Array<{ path: string; isGitRepo: boolean }>) => {
  try {
    await ensureFilebarDir()
    const sanitizedName = name.replace(/[^a-zA-Z0-9_-]/g, '_')
    const filePath = path.join(getFilebarDir(), `${sanitizedName}.json`)
    await fs.writeFile(filePath, JSON.stringify({ name, folders }, null, 2), 'utf-8')
    return { success: true, path: filePath }
  } catch (error) {
    return { success: false, error: String(error) }
  }
})

ipcMain.handle('filebar:list', async () => {
  try {
    await ensureFilebarDir()
    const dir = getFilebarDir()
    const files = await fs.readdir(dir)
    const filebars: Array<{ name: string; fileName: string; folderCount: number }> = []

    for (const file of files) {
      if (!file.endsWith('.json')) continue
      try {
        const content = await fs.readFile(path.join(dir, file), 'utf-8')
        const data = JSON.parse(content)
        filebars.push({
          name: data.name || file.replace('.json', ''),
          fileName: file,
          folderCount: data.folders?.length || 0
        })
      } catch {
        // Skip invalid files
      }
    }

    return { success: true, filebars }
  } catch (error) {
    return { success: false, error: String(error), filebars: [] }
  }
})

ipcMain.handle('filebar:load', async (_, fileName: string) => {
  try {
    const filePath = path.join(getFilebarDir(), fileName)
    const content = await fs.readFile(filePath, 'utf-8')
    const data = JSON.parse(content)
    return { success: true, folders: data.folders || [] }
  } catch (error) {
    return { success: false, error: String(error) }
  }
})

ipcMain.handle('filebar:delete', async (_, fileName: string) => {
  try {
    const filePath = path.join(getFilebarDir(), fileName)
    await fs.unlink(filePath)
    return { success: true }
  } catch (error) {
    return { success: false, error: String(error) }
  }
})

app.whenReady().then(() => {
  createWindow()

  // Handle file opened from command line on Linux (file manager, terminal, etc.)
  // On macOS, this is handled by the 'open-file' event instead
  const initialFilePath = getFilePathFromArgs(process.argv)
  if (initialFilePath && mainWindow) {
    // Wait for window to be ready to receive IPC messages before opening file
    mainWindow.once('ready-to-show', () => {
      openFile(initialFilePath)
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  stopFileWatcher()
  stopDirectoryWatcher()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

/**
 * Extract supported file path from command line arguments.
 * Used for both initial launch and second-instance handling on Linux.
 */
function getFilePathFromArgs(args: string[]): string | undefined {
  return args.find(arg => {
    if (!existsSync(arg)) return false
    const ext = getFileExtension(arg)
    return SUPPORTED_EXTENSIONS.includes(ext)
  })
}

// Handle file opened via file association on macOS (uses open-file event)
app.on('open-file', async (event, filePath) => {
  event.preventDefault()
  if (mainWindow) {
    await openFile(filePath)
  } else {
    app.whenReady().then(() => openFile(filePath))
  }
})

// Handle second instance (for single instance lock)
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  // Handle file opened when app is already running (Linux second instance)
  app.on('second-instance', (_, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()

      const filePath = getFilePathFromArgs(commandLine)
      if (filePath) {
        openFile(filePath)
      }
    }
  })
}
