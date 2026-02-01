/**
 * Git IPC Handlers
 *
 * Provides Git operations for the renderer process via IPC.
 * Includes conflict detection and resolution support for a
 * user-friendly merge experience.
 */

import { IpcMain } from 'electron'
import simpleGit, { SimpleGit } from 'simple-git'
import path from 'path'
import fs from 'fs/promises'

export function setupGitHandlers(ipcMain: IpcMain, getCurrentFilePath: () => string | null) {
  /**
   * Creates a SimpleGit instance for local operations.
   */
  function getGitInstance(): SimpleGit | null {
    const filePath = getCurrentFilePath()
    if (!filePath) return null
    const dir = path.dirname(filePath)
    return simpleGit(dir)
  }

  /**
   * Creates a SimpleGit instance configured for network operations.
   * Sets environment variables to prevent Git from prompting for credentials
   * in the terminal, which would spam the console in an Electron app.
   */
  function getGitInstanceForNetwork(): SimpleGit | null {
    const filePath = getCurrentFilePath()
    if (!filePath) return null
    const dir = path.dirname(filePath)
    return simpleGit(dir).env({
      ...process.env,
      GIT_TERMINAL_PROMPT: '0'
    })
  }

  /**
   * Gets the repository root directory for the current file.
   */
  function getRepoRoot(): string | null {
    const filePath = getCurrentFilePath()
    if (!filePath) return null
    return path.dirname(filePath)
  }

  ipcMain.handle('git:isRepo', async () => {
    try {
      const git = getGitInstance()
      if (!git) return false
      return await git.checkIsRepo()
    } catch {
      return false
    }
  })

  /**
   * Checks if a given folder path is a git repository.
   * Used for checking if the explorer folder is a git repo.
   */
  ipcMain.handle('git:isRepoAtPath', async (_, folderPath: string) => {
    try {
      const git = simpleGit(folderPath)
      return await git.checkIsRepo()
    } catch {
      return false
    }
  })

  ipcMain.handle('git:status', async () => {
    const git = getGitInstance()
    if (!git) throw new Error('No file open')
    const status = await git.status()
    return {
      current: status.current,
      tracking: status.tracking,
      files: status.files.map(f => ({
        path: f.path,
        index: f.index,
        working_dir: f.working_dir
      })),
      ahead: status.ahead,
      behind: status.behind
    }
  })

  ipcMain.handle('git:branches', async () => {
    const git = getGitInstance()
    if (!git) throw new Error('No file open')
    const branches = await git.branchLocal()
    return {
      all: branches.all,
      current: branches.current
    }
  })

  ipcMain.handle('git:checkout', async (_, branch: string) => {
    try {
      const git = getGitInstance()
      if (!git) throw new Error('No file open')
      await git.checkout(branch)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('git:pull', async () => {
    try {
      const git = getGitInstanceForNetwork()
      if (!git) throw new Error('No file open')
      await git.pull()
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('git:commit', async (_, message: string) => {
    try {
      const git = getGitInstance()
      if (!git) throw new Error('No file open')
      await git.commit(message)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('git:push', async () => {
    try {
      const git = getGitInstanceForNetwork()
      if (!git) throw new Error('No file open')
      await git.push()
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('git:add', async (_, files: string[]) => {
    try {
      const git = getGitInstance()
      if (!git) throw new Error('No file open')
      await git.add(files)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  /**
   * Fetches from remote to update ahead/behind counts.
   * This doesn't modify local files, just updates the remote tracking info.
   */
  ipcMain.handle('git:fetch', async () => {
    try {
      const git = getGitInstanceForNetwork()
      if (!git) throw new Error('No file open')
      await git.fetch()
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  /**
   * Pulls from remote and detects conflicts.
   * Returns the conflicted file content if there are merge conflicts.
   */
  ipcMain.handle('git:pullWithConflictDetection', async () => {
    try {
      const git = getGitInstanceForNetwork()
      if (!git) throw new Error('No file open')
      const filePath = getCurrentFilePath()
      if (!filePath) throw new Error('No file open')

      try {
        await git.pull()
        // Pull succeeded without conflicts
        const content = await fs.readFile(filePath, 'utf-8')
        return { success: true, content, hasConflicts: false }
      } catch (pullError) {
        // Check if this is a merge conflict
        const errorStr = String(pullError)
        if (errorStr.includes('CONFLICT') || errorStr.includes('Merge conflict')) {
          // Read the file with conflict markers
          const content = await fs.readFile(filePath, 'utf-8')
          return { success: true, content, hasConflicts: true }
        }
        // Some other pull error
        throw pullError
      }
    } catch (error) {
      return { success: false, error: String(error), hasConflicts: false }
    }
  })

  /**
   * Reads the current file content from disk.
   * Used after pull to get updated content.
   */
  ipcMain.handle('git:readCurrentFile', async () => {
    try {
      const filePath = getCurrentFilePath()
      if (!filePath) throw new Error('No file open')
      const content = await fs.readFile(filePath, 'utf-8')
      return { success: true, content }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  /**
   * Writes resolved content to the file and stages it for commit.
   * Used after the user resolves merge conflicts.
   */
  ipcMain.handle('git:writeResolution', async (_, content: string) => {
    try {
      const git = getGitInstance()
      if (!git) throw new Error('No file open')
      const filePath = getCurrentFilePath()
      if (!filePath) throw new Error('No file open')
      const repoRoot = getRepoRoot()
      if (!repoRoot) throw new Error('No repo root')

      // Write the resolved content
      await fs.writeFile(filePath, content, 'utf-8')

      // Stage the file to mark conflict as resolved
      const relativePath = path.relative(repoRoot, filePath)
      await git.add([relativePath])

      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  /**
   * Aborts an in-progress merge operation.
   * Resets the working directory to the pre-merge state.
   */
  ipcMain.handle('git:abortMerge', async () => {
    try {
      const git = getGitInstance()
      if (!git) throw new Error('No file open')
      await git.merge(['--abort'])
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  /**
   * Stages all changes (git add -A).
   */
  ipcMain.handle('git:addAll', async () => {
    try {
      const git = getGitInstance()
      if (!git) throw new Error('No file open')
      await git.add(['-A'])
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  /**
   * Stashes current changes.
   */
  ipcMain.handle('git:stash', async () => {
    try {
      const git = getGitInstance()
      if (!git) throw new Error('No file open')
      await git.stash()
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  /**
   * Pops the most recent stash.
   */
  ipcMain.handle('git:stashPop', async () => {
    try {
      const git = getGitInstance()
      if (!git) throw new Error('No file open')
      await git.stash(['pop'])
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  /**
   * Pushes with conflict handling.
   * If push fails due to remote changes, stashes local changes,
   * pulls from remote, and pops stash to merge.
   * Returns conflict info if there are merge conflicts.
   */
  ipcMain.handle('git:pushWithConflictHandling', async () => {
    try {
      const git = getGitInstanceForNetwork()
      if (!git) throw new Error('No file open')
      const filePath = getCurrentFilePath()
      if (!filePath) throw new Error('No file open')

      try {
        // Try pushing first
        await git.push()
        return { success: true, hasConflicts: false }
      } catch (pushError) {
        const errorStr = String(pushError)

        // Check if push failed because remote has changes
        if (errorStr.includes('rejected') || errorStr.includes('non-fast-forward') ||
            errorStr.includes('fetch first') || errorStr.includes('behind')) {
          // Stash local changes, pull, then pop stash
          const localGit = getGitInstance()
          if (!localGit) throw new Error('No file open')

          try {
            await localGit.stash()
            await git.pull()
            await localGit.stash(['pop'])

            // Check if stash pop caused conflicts
            const content = await fs.readFile(filePath, 'utf-8')
            if (content.includes('<<<<<<<') && content.includes('>>>>>>>')) {
              return { success: true, content, hasConflicts: true }
            }

            // No conflicts, try pushing again
            await git.push()
            return { success: true, hasConflicts: false }
          } catch (conflictError) {
            const conflictStr = String(conflictError)
            if (conflictStr.includes('CONFLICT') || conflictStr.includes('conflict')) {
              const content = await fs.readFile(filePath, 'utf-8')
              return { success: true, content, hasConflicts: true }
            }
            throw conflictError
          }
        }
        throw pushError
      }
    } catch (error) {
      return { success: false, error: String(error), hasConflicts: false }
    }
  })
}
