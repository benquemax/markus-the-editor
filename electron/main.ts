import { app, BrowserWindow, ipcMain, dialog, Menu, shell, protocol, net } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import { existsSync, mkdirSync } from 'fs'
import os from 'os'
import { createMenu } from './menu'
import { setupFileWatcher, stopFileWatcher } from './fileWatcher'
import { setupGitHandlers } from './git'
import Store from 'electron-store'

// Disable GPU acceleration if it causes issues on some Linux systems
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
  const result = await showOpenDialog({
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

// Handle file dropped onto window
ipcMain.handle('file:openPath', async (_, filePath: string) => {
  if (existsSync(filePath)) {
    await openFile(filePath)
    return { success: true }
  }
  return { success: false, error: 'File not found' }
})

// Image handling IPC handlers

/**
 * Get the image folder path for a document.
 * For saved documents: <filename>/ (e.g., "notes.md" -> "notes/")
 * For unsaved documents: system temp folder
 */
function getImageFolderPath(docPath: string | null): { folder: string; isTemp: boolean } {
  if (docPath) {
    // Use document name without extension as folder name
    const dir = path.dirname(docPath)
    const basename = path.basename(docPath, path.extname(docPath))
    return { folder: path.join(dir, basename), isTemp: false }
  }
  // Use temp folder for unsaved documents
  return { folder: path.join(os.tmpdir(), 'markus-images'), isTemp: true }
}

/**
 * Save an image file to the appropriate folder.
 * Returns the relative path for the markdown image reference.
 */
ipcMain.handle('image:save', async (_, options: {
  imageName: string
  imageData: string // base64 encoded
  mimeType: string
}) => {
  try {
    const { folder, isTemp } = getImageFolderPath(currentFilePath)

    // Create folder if it doesn't exist
    if (!existsSync(folder)) {
      mkdirSync(folder, { recursive: true })
    }

    // Decode base64 image data
    const buffer = Buffer.from(options.imageData, 'base64')

    // Save the image
    const imagePath = path.join(folder, options.imageName)
    await fs.writeFile(imagePath, buffer)

    // Return the relative path for markdown
    let relativePath: string
    if (isTemp) {
      // For temp images, return absolute path (will be updated when document is saved)
      relativePath = imagePath
    } else {
      // For saved documents, return path relative to document folder
      const basename = path.basename(currentFilePath!, path.extname(currentFilePath!))
      relativePath = `${basename}/${options.imageName}`
    }

    return { success: true, relativePath, isTemp, absolutePath: imagePath }
  } catch (error) {
    return { success: false, error: String(error) }
  }
})

/**
 * List existing images in the document's image folder.
 * Used for auto-numbering (e.g., image-1.png, image-2.png).
 */
ipcMain.handle('image:listExisting', async (_, pattern?: string) => {
  try {
    const { folder } = getImageFolderPath(currentFilePath)

    if (!existsSync(folder)) {
      return { success: true, files: [] }
    }

    const files = await fs.readdir(folder)

    // Filter by pattern if provided (e.g., "image-*.png")
    let filtered = files
    if (pattern) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
      filtered = files.filter(f => regex.test(f))
    }

    return { success: true, files: filtered }
  } catch (error) {
    return { success: false, error: String(error), files: [] }
  }
})

/**
 * Move images from temp folder to final location when document is saved.
 * Returns a map of old paths to new paths for updating references in the document.
 */
ipcMain.handle('image:moveFromTemp', async (_, options: {
  tempPaths: string[]
  targetDocPath: string
}) => {
  try {
    const dir = path.dirname(options.targetDocPath)
    const basename = path.basename(options.targetDocPath, path.extname(options.targetDocPath))
    const targetFolder = path.join(dir, basename)

    // Create target folder if it doesn't exist
    if (!existsSync(targetFolder)) {
      mkdirSync(targetFolder, { recursive: true })
    }

    const pathMap: Record<string, string> = {}

    for (const tempPath of options.tempPaths) {
      if (!existsSync(tempPath)) continue

      const imageName = path.basename(tempPath)
      const newPath = path.join(targetFolder, imageName)

      // Move the file
      await fs.copyFile(tempPath, newPath)
      await fs.unlink(tempPath)

      // Map old path to new relative path
      pathMap[tempPath] = `${basename}/${imageName}`
    }

    return { success: true, pathMap }
  } catch (error) {
    return { success: false, error: String(error), pathMap: {} }
  }
})

/**
 * Get the image folder path for the current document.
 */
ipcMain.handle('image:getFolderPath', async () => {
  const { folder, isTemp } = getImageFolderPath(currentFilePath)
  return { folder, isTemp, docPath: currentFilePath }
})

// Register custom protocol for serving local images
// This allows the renderer to load images from the file system securely
// Usage: local-image:///path/to/image.png
//
// IMPORTANT: This protocol is essential for displaying local images in the editor.
// Without it, images saved to the filesystem cannot be displayed because Electron's
// renderer process blocks file:// URLs for security reasons. Do not remove or modify
// the protocol name without updating all references in:
// - src/components/ImageFilenameDialog.tsx (where display URLs are constructed)
// - index.html (CSP img-src directive)
// - src/editor/markdown.ts (if path resolution is added for existing images)
protocol.registerSchemesAsPrivileged([{
  scheme: 'local-image',
  privileges: {
    secure: true,
    supportFetchAPI: true,
    bypassCSP: true,
    stream: true
  }
}])

app.whenReady().then(() => {
  // Handle the custom local-image protocol
  // Converts local-image:// URLs to file:// URLs and serves the content
  protocol.handle('local-image', (request) => {
    // Extract the file path from the URL
    // local-image:///path/to/file.png -> /path/to/file.png
    const filePath = decodeURIComponent(request.url.replace('local-image://', ''))
    return net.fetch(`file://${filePath}`)
  })

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
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

/**
 * Extract markdown file path from command line arguments.
 * Used for both initial launch and second-instance handling on Linux.
 */
function getFilePathFromArgs(args: string[]): string | undefined {
  return args.find(arg =>
    (arg.endsWith('.md') || arg.endsWith('.markdown')) && existsSync(arg)
  )
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
