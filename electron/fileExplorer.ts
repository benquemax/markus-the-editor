/**
 * File Explorer IPC Handlers
 *
 * Provides directory and file operations for the file explorer sidebar.
 * Uses simple-git for git-related operations (finding git root, getting file statuses)
 * and Node's fs module for directory reading.
 */

import { IpcMain, BrowserWindow, dialog } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import simpleGit from 'simple-git'

export interface FileEntry {
  name: string
  path: string
  type: 'file' | 'directory'
}

export interface GitFileStatus {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed'
}

export interface DiffHunk {
  startLine: number
  endLine: number
  type: 'added' | 'modified'
}

export function setupFileExplorerHandlers(ipcMain: IpcMain, getMainWindow: () => BrowserWindow | null) {
  /**
   * Reads directory contents and returns file entries.
   * Filters out hidden files (starting with .) and common ignored directories.
   */
  ipcMain.handle('explorer:readDirectory', async (_, dirPath: string) => {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true })

      // Filter and map entries
      const fileEntries: FileEntry[] = entries
        .filter(entry => {
          // Filter out hidden files and common ignored directories
          if (entry.name.startsWith('.')) return false
          if (entry.name === 'node_modules') return false
          return true
        })
        .map(entry => ({
          name: entry.name,
          path: path.join(dirPath, entry.name),
          type: entry.isDirectory() ? 'directory' : 'file'
        }))
        .sort((a, b) => {
          // Directories first, then files, both alphabetically
          if (a.type !== b.type) {
            return a.type === 'directory' ? -1 : 1
          }
          return a.name.localeCompare(b.name)
        })

      return { success: true, entries: fileEntries }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  /**
   * Opens a folder dialog and returns the selected path.
   */
  ipcMain.handle('explorer:openFolder', async () => {
    const mainWindow = getMainWindow()
    if (!mainWindow) return { success: false, error: 'No window' }

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: 'Cancelled' }
    }

    return { success: true, path: result.filePaths[0] }
  })

  /**
   * Finds the git repository root for a given path.
   * Returns null if the path is not inside a git repository.
   */
  ipcMain.handle('explorer:getGitRoot', async (_, filePath: string) => {
    try {
      const git = simpleGit(filePath)
      const isRepo = await git.checkIsRepo()

      if (!isRepo) {
        return { success: true, gitRoot: null }
      }

      // Get the root directory of the repo
      const root = await git.revparse(['--show-toplevel'])
      return { success: true, gitRoot: root.trim() }
    } catch {
      return { success: true, gitRoot: null }
    }
  })

  /**
   * Gets the git status for all files in a repository.
   * Returns a map of file paths to their git status.
   */
  ipcMain.handle('explorer:getGitStatus', async (_, gitRoot: string) => {
    try {
      const git = simpleGit(gitRoot)
      const status = await git.status()

      const files: GitFileStatus[] = []

      // Process all file statuses
      for (const file of status.files) {
        let fileStatus: GitFileStatus['status'] | null = null

        // Check index status first (staged changes)
        if (file.index === 'M' || file.working_dir === 'M') {
          fileStatus = 'modified'
        } else if (file.index === 'A') {
          fileStatus = 'added'
        } else if (file.index === 'D' || file.working_dir === 'D') {
          fileStatus = 'deleted'
        } else if (file.index === 'R') {
          fileStatus = 'renamed'
        } else if (file.index === '?' && file.working_dir === '?') {
          fileStatus = 'untracked'
        }

        if (fileStatus) {
          files.push({
            path: path.join(gitRoot, file.path),
            status: fileStatus
          })
        }
      }

      return { success: true, files }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  /**
   * Creates a new file at the specified path.
   */
  ipcMain.handle('explorer:createFile', async (_, filePath: string) => {
    try {
      // Check if file already exists
      try {
        await fs.access(filePath)
        return { success: false, error: 'File already exists' }
      } catch {
        // File doesn't exist, good to create
      }

      // Create the file with empty content
      await fs.writeFile(filePath, '', 'utf-8')
      return { success: true, path: filePath }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  /**
   * Creates a new directory at the specified path.
   */
  ipcMain.handle('explorer:createDirectory', async (_, dirPath: string) => {
    try {
      // Check if directory already exists
      try {
        await fs.access(dirPath)
        return { success: false, error: 'Directory already exists' }
      } catch {
        // Directory doesn't exist, good to create
      }

      // Create the directory
      await fs.mkdir(dirPath, { recursive: true })
      return { success: true, path: dirPath }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  /**
   * Gets the diff hunks for a file compared to HEAD.
   * Returns line ranges that have been added or modified.
   */
  ipcMain.handle('explorer:getFileDiff', async (_, filePath: string) => {
    try {
      const dir = path.dirname(filePath)
      const git = simpleGit(dir)

      // Check if in a git repo
      const isRepo = await git.checkIsRepo()
      if (!isRepo) {
        return { success: true, hunks: [] }
      }

      // Get unified diff output
      const diff = await git.diff(['HEAD', '--unified=0', '--', filePath])

      if (!diff) {
        return { success: true, hunks: [] }
      }

      const hunks: DiffHunk[] = []

      // Parse diff output for line ranges
      // Format: @@ -oldStart,oldCount +newStart,newCount @@
      const hunkRegex = /@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/g
      let match

      while ((match = hunkRegex.exec(diff)) !== null) {
        const startLine = parseInt(match[1], 10)
        const lineCount = match[2] ? parseInt(match[2], 10) : 1

        if (lineCount > 0) {
          hunks.push({
            startLine,
            endLine: startLine + lineCount - 1,
            type: 'modified'
          })
        }
      }

      return { success: true, hunks }
    } catch (error) {
      return { success: false, error: String(error), hunks: [] }
    }
  })
}
