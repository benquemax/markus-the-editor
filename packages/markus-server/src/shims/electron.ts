/**
 * Electron Shim for Standalone Server
 *
 * Provides minimal mock implementations of Electron APIs
 * that are used by shared modules.
 */

import * as os from 'os'

/**
 * Mock app module providing getPath functionality.
 */
export const app = {
  getPath(name: string): string {
    switch (name) {
      case 'home':
        return os.homedir()
      case 'userData':
        return os.homedir()
      case 'appData':
        return os.homedir()
      default:
        return os.homedir()
    }
  }
}

/**
 * Mock BrowserWindow - not used in server mode.
 */
export class BrowserWindow {
  webContents = {
    send: () => {}
  }
}

/**
 * Mock IpcMain - not used in server mode.
 */
export const ipcMain = {
  handle: () => {},
  on: () => {}
}

// Default export to match electron's module structure
export default { app, BrowserWindow, ipcMain }
