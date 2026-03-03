/**
 * Converter IPC Handler Registration
 *
 * Wires up the import/export pipelines to Electron IPC channels so the
 * renderer can trigger file conversions. All dialog interactions (open/save)
 * happen here in the main process using the shared dialog helpers from main.ts,
 * keeping the renderer thin.
 *
 * Channels:
 * - converter:importFile      — import a known file path (drag-and-drop)
 * - converter:importWithDialog — show open dialog, then import
 * - converter:exportFile       — export content to DOCX/ODT/HTML
 * - converter:importUrl        — fetch web page by URL, convert to markdown
 */

import { IpcMain, BrowserWindow, shell } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import { importFile, IMPORTABLE_EXTENSIONS } from './importers'
import { exportDocx, exportOdt, exportHtml } from './exporters'
import { importUrl } from './urlImporter'

type DialogResult<T> = T
type OpenDialogFn = (options: Electron.OpenDialogOptions) => Promise<DialogResult<Electron.OpenDialogReturnValue>>
type SaveDialogFn = (options: Electron.SaveDialogOptions) => Promise<DialogResult<Electron.SaveDialogReturnValue>>
type MessageBoxFn = (options: Electron.MessageBoxOptions) => Promise<DialogResult<Electron.MessageBoxReturnValue>>
type GetCurrentFilePathFn = () => string | null
type SetCurrentFilePathFn = (filePath: string) => void

interface ConverterDeps {
  ipcMain: IpcMain
  getMainWindow: () => BrowserWindow | null
  showSaveDialog: SaveDialogFn
  showOpenDialog: OpenDialogFn
  showMessageBox: MessageBoxFn
  getCurrentFilePath: GetCurrentFilePathFn
  setCurrentFilePath: SetCurrentFilePathFn
}

/**
 * Registers all converter IPC handlers. Called once from main.ts during setup.
 *
 * Dialog helpers are injected from main.ts to follow the DRY pattern —
 * the same helpers that ensure proper parent window attachment are reused here.
 */
export function setupConverterHandlers({
  ipcMain,
  getMainWindow,
  showSaveDialog,
  showOpenDialog,
  showMessageBox,
  getCurrentFilePath,
  setCurrentFilePath
}: ConverterDeps): void {

  /**
   * Import a file from a known path (drag-and-drop flow).
   * Shows a save dialog for the output .md path, converts, then opens the result.
   *
   * Optional targetDir overrides where the save dialog defaults to — used when
   * a file is dropped onto a specific workspace folder so the .md lands there
   * instead of next to the source file.
   */
  ipcMain.handle('converter:importFile', async (_, sourcePath: string, targetDir?: string) => {
    try {
      console.log(`[Converter] Importing ${sourcePath}` + (targetDir ? ` → target dir: ${targetDir}` : ''))

      const ext = path.extname(sourcePath).toLowerCase()
      if (!IMPORTABLE_EXTENSIONS.includes(ext)) {
        console.warn(`[Converter] Unsupported format: ${ext}`)
        return { success: false, error: `Unsupported format: ${ext}` }
      }

      // Default output: target directory (if provided) or same directory as source,
      // with the same basename swapped to .md
      const baseName = path.basename(sourcePath).replace(/\.[^.]+$/, '.md')
      const defaultPath = targetDir
        ? path.join(targetDir, baseName)
        : sourcePath.replace(/\.[^.]+$/, '.md')

      const saveResult = await showSaveDialog({
        title: 'Save converted Markdown as...',
        defaultPath,
        filters: [
          { name: 'Markdown', extensions: ['md'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })

      if (saveResult.canceled || !saveResult.filePath) {
        console.log('[Converter] Save dialog cancelled')
        return { success: false, error: 'Cancelled' }
      }

      console.log(`[Converter] Converting ${path.basename(sourcePath)} → ${saveResult.filePath}`)
      const markdown = await importFile(sourcePath)
      console.log(`[Converter] Conversion complete (${markdown.length} chars), writing to disk...`)
      await fs.writeFile(saveResult.filePath, markdown, 'utf-8')
      console.log(`[Converter] Successfully wrote ${saveResult.filePath}`)

      // Update main process state so export uses the right filename
      setCurrentFilePath(saveResult.filePath)

      // Open the converted file in the editor
      const mainWindow = getMainWindow()
      if (mainWindow) {
        mainWindow.webContents.send('file:opened', {
          content: markdown,
          filePath: saveResult.filePath
        })
      }

      return { success: true, filePath: saveResult.filePath }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error('[Converter] Import failed:', error instanceof Error ? error.stack || msg : msg)
      // Show the error to the user so they know what went wrong
      await showMessageBox({
        type: 'error',
        title: 'Import Failed',
        message: msg
      })
      return { success: false, error: msg }
    }
  })

  /**
   * Import via menu: shows open dialog to pick a file, then save dialog for output.
   */
  ipcMain.handle('converter:importWithDialog', async () => {
    try {
      // File picker for importable formats
      const openResult = await showOpenDialog({
        title: 'Import document...',
        properties: ['openFile'],
        filters: [
          { name: 'Documents', extensions: ['docx', 'doc', 'odt', 'pdf', 'html', 'htm'] },
          { name: 'Word Document', extensions: ['docx', 'doc'] },
          { name: 'OpenDocument', extensions: ['odt'] },
          { name: 'PDF', extensions: ['pdf'] },
          { name: 'HTML', extensions: ['html', 'htm'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })

      if (openResult.canceled || openResult.filePaths.length === 0) {
        return { success: false, error: 'Cancelled' }
      }

      const sourcePath = openResult.filePaths[0]
      const ext = path.extname(sourcePath).toLowerCase()

      // For PDF imports, warn the user about lossy conversion
      if (ext === '.pdf') {
        const warnResult = await showMessageBox({
          type: 'info',
          title: 'PDF Import',
          message: 'PDF conversion extracts text only. Formatting, images, and layout will be lost.',
          buttons: ['Continue', 'Cancel']
        })
        if (warnResult.response === 1) {
          return { success: false, error: 'Cancelled' }
        }
      }

      // Save dialog for the output .md file
      const defaultPath = sourcePath.replace(/\.[^.]+$/, '.md')

      const saveResult = await showSaveDialog({
        title: 'Save converted Markdown as...',
        defaultPath,
        filters: [
          { name: 'Markdown', extensions: ['md'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })

      if (saveResult.canceled || !saveResult.filePath) {
        return { success: false, error: 'Cancelled' }
      }

      const markdown = await importFile(sourcePath)
      await fs.writeFile(saveResult.filePath, markdown, 'utf-8')

      // Update main process state so export uses the right filename
      setCurrentFilePath(saveResult.filePath)

      // Open the converted file in the editor
      const mainWindow = getMainWindow()
      if (mainWindow) {
        mainWindow.webContents.send('file:opened', {
          content: markdown,
          filePath: saveResult.filePath
        })
      }

      return { success: true, filePath: saveResult.filePath }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error('[Converter] Import failed:', error instanceof Error ? error.stack || msg : msg)
      await showMessageBox({
        type: 'error',
        title: 'Import Failed',
        message: msg
      })
      return { success: false, error: msg }
    }
  })

  /**
   * Export current document to DOCX, ODT, or HTML.
   * The renderer sends the current markdown content and desired format.
   */
  ipcMain.handle('converter:exportFile', async (_, payload: { content: string; format: 'docx' | 'odt' | 'html' }) => {
    try {
      const { content, format } = payload
      const currentPath = getCurrentFilePath()
      const baseName = currentPath
        ? path.basename(currentPath, path.extname(currentPath))
        : 'document'
      const title = baseName

      // Format-specific file filters and default extension
      const formatConfig = {
        docx: { name: 'Word Document', extensions: ['docx'], defaultExt: '.docx' },
        odt: { name: 'OpenDocument Text', extensions: ['odt'], defaultExt: '.odt' },
        html: { name: 'HTML', extensions: ['html', 'htm'], defaultExt: '.html' }
      }

      const config = formatConfig[format]
      const defaultPath = currentPath
        ? currentPath.replace(/\.[^.]+$/, config.defaultExt)
        : `${baseName}${config.defaultExt}`

      const saveResult = await showSaveDialog({
        title: `Export as ${config.name}...`,
        defaultPath,
        filters: [
          { name: config.name, extensions: config.extensions },
          { name: 'All Files', extensions: ['*'] }
        ]
      })

      if (saveResult.canceled || !saveResult.filePath) {
        return { success: false, error: 'Cancelled' }
      }

      // Run the appropriate export pipeline
      let data: Buffer | string
      switch (format) {
        case 'docx':
          data = await exportDocx(content, title)
          break
        case 'odt':
          data = await exportOdt(content, title)
          break
        case 'html':
          data = await exportHtml(content, title)
          break
      }

      if (typeof data === 'string') {
        await fs.writeFile(saveResult.filePath, data, 'utf-8')
      } else {
        await fs.writeFile(saveResult.filePath, data)
      }

      // Open the exported file in the system's default application
      shell.openPath(saveResult.filePath)

      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  /**
   * Import a web page by URL. Fetches HTML, extracts article content using
   * Defuddle, converts to markdown with frontmatter metadata.
   *
   * When targetDir is provided (folder drop), shows save dialog and writes file.
   * When targetDir is null (editor drop / menu), returns markdown for an unsaved tab.
   */
  ipcMain.handle('converter:importUrl', async (_, url: string, targetDir?: string) => {
    try {
      console.log(`[Converter] Importing URL: ${url}` + (targetDir ? ` → target dir: ${targetDir}` : ''))

      const result = await importUrl(url)

      if (targetDir) {
        // Folder drop flow: save to disk with slug-based default filename
        const defaultPath = path.join(targetDir, `${result.slug}.md`)

        const saveResult = await showSaveDialog({
          title: 'Save imported page as...',
          defaultPath,
          filters: [
            { name: 'Markdown', extensions: ['md'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        })

        if (saveResult.canceled || !saveResult.filePath) {
          return { success: false, error: 'Cancelled' }
        }

        await fs.writeFile(saveResult.filePath, result.markdown, 'utf-8')
        setCurrentFilePath(saveResult.filePath)

        // Open the saved file in the editor
        const mainWindow = getMainWindow()
        if (mainWindow) {
          mainWindow.webContents.send('file:opened', {
            content: result.markdown,
            filePath: saveResult.filePath
          })
        }

        return { success: true, filePath: saveResult.filePath }
      } else {
        // Editor drop / menu flow: return markdown for unsaved tab
        return { success: true, markdown: result.markdown, title: result.title }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error('[Converter] URL import failed:', error instanceof Error ? error.stack || msg : msg)
      await showMessageBox({
        type: 'error',
        title: 'URL Import Failed',
        message: `Could not import page:\n${msg}`
      })
      return { success: false, error: msg }
    }
  })
}
