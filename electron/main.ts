import { app, BrowserWindow, ipcMain, dialog, Menu, shell } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import { existsSync } from 'fs'
import { createMenu } from './menu'
import { setupFileWatcher, stopFileWatcher } from './fileWatcher'
import { setupGitHandlers } from './git'
import Store from 'electron-store'

// Disable GPU acceleration if it causes issues
app.disableHardwareAcceleration()

const store = new Store({
  defaults: {
    recentFiles: [] as string[],
    windowBounds: { width: 1200, height: 800 },
    theme: 'system' as 'light' | 'dark' | 'system'
  }
})

let mainWindow: BrowserWindow | null = null
let currentFilePath: string | null = null

const DIST = path.join(__dirname, '../dist')
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

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
    // Open DevTools in development
    mainWindow?.webContents.openDevTools()
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
    onNewFile: () => handleNewFile(),
    onOpenFile: () => handleOpenFile(),
    onSaveFile: () => handleSaveFile(),
    onSaveAsFile: () => handleSaveAsFile(),
    onPrintToPdf: () => handlePrintToPdf(),
    getRecentFiles: () => store.get('recentFiles') as string[],
    onOpenRecentFile: (filePath: string) => openFile(filePath),
    onClearRecentFiles: () => store.set('recentFiles', [])
  })

  Menu.setApplicationMenu(menu)
}

async function handleNewFile() {
  if (mainWindow) {
    currentFilePath = null
    mainWindow.setTitle('Markus - Untitled')
    mainWindow.webContents.send('file:new')
  }
}

async function handleOpenFile() {
  if (!mainWindow) return

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  })

  if (!result.canceled && result.filePaths.length > 0) {
    await openFile(result.filePaths[0])
  }
}

async function openFile(filePath: string) {
  if (!mainWindow) return

  try {
    const content = await fs.readFile(filePath, 'utf-8')
    currentFilePath = filePath
    mainWindow.setTitle(`Markus - ${path.basename(filePath)}`)
    mainWindow.webContents.send('file:opened', { content, filePath })
    addToRecentFiles(filePath)
    setupFileWatcher(filePath, mainWindow)
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

  const result = await dialog.showSaveDialog(mainWindow, {
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

  const result = await dialog.showSaveDialog(mainWindow, {
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

  const result = await dialog.showSaveDialog(mainWindow, {
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

ipcMain.handle('dialog:showMessage', async (_, options: { type: string; title: string; message: string; buttons: string[] }) => {
  if (!mainWindow) return { response: 0 }
  const result = await dialog.showMessageBox(mainWindow, {
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

// Handle file dropped onto window
ipcMain.handle('file:openPath', async (_, filePath: string) => {
  if (existsSync(filePath)) {
    await openFile(filePath)
    return { success: true }
  }
  return { success: false, error: 'File not found' }
})

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  stopFileWatcher()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Handle file opened via command line or file association
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
  app.on('second-instance', (_, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()

      // Check for file path in command line arguments
      const filePath = commandLine.find(arg =>
        arg.endsWith('.md') || arg.endsWith('.markdown')
      )
      if (filePath && existsSync(filePath)) {
        openFile(filePath)
      }
    }
  })
}
