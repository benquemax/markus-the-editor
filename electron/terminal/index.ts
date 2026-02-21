/**
 * Terminal IPC handler registration.
 *
 * Bridges the renderer's terminal requests to the terminalManager.
 * Each PTY's stdout and exit events are forwarded back to the renderer
 * via the window's webContents.send().
 */

import { IpcMain, BrowserWindow } from 'electron'
import {
  createTerminal,
  writeTerminal,
  resizeTerminal,
  destroyTerminal,
  destroyAllTerminals
} from './terminalManager'

export { destroyAllTerminals }

export function setupTerminalHandlers(
  ipcMain: IpcMain,
  getMainWindow: () => BrowserWindow | null,
  getDefaultCwd: () => string
): void {
  ipcMain.handle('terminal:create', (_, cwd?: string, cols?: number, rows?: number) => {
    const win = getMainWindow()
    if (!win) return null

    const resolvedCwd = cwd || getDefaultCwd()

    const id = createTerminal(
      resolvedCwd,
      cols || 80,
      rows || 24,
      (data) => {
        // Guard against window being destroyed while PTY flushes
        if (!win.isDestroyed()) {
          win.webContents.send('terminal:data', { id, data })
        }
      },
      (exitCode) => {
        if (!win.isDestroyed()) {
          win.webContents.send('terminal:exit', { id, exitCode })
        }
      }
    )

    return id
  })

  ipcMain.handle('terminal:write', (_, id: string, data: string) => {
    writeTerminal(id, data)
  })

  ipcMain.handle('terminal:resize', (_, id: string, cols: number, rows: number) => {
    resizeTerminal(id, cols, rows)
  })

  ipcMain.handle('terminal:destroy', (_, id: string) => {
    destroyTerminal(id)
  })
}
