import { IpcMain } from 'electron'
import simpleGit, { SimpleGit } from 'simple-git'
import path from 'path'

export function setupGitHandlers(ipcMain: IpcMain, getCurrentFilePath: () => string | null) {
  function getGitInstance(): SimpleGit | null {
    const filePath = getCurrentFilePath()
    if (!filePath) return null
    const dir = path.dirname(filePath)
    return simpleGit(dir)
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

  ipcMain.handle('git:status', async () => {
    try {
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
    } catch (error) {
      throw error
    }
  })

  ipcMain.handle('git:branches', async () => {
    try {
      const git = getGitInstance()
      if (!git) throw new Error('No file open')
      const branches = await git.branchLocal()
      return {
        all: branches.all,
        current: branches.current
      }
    } catch (error) {
      throw error
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
      const git = getGitInstance()
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
      const git = getGitInstance()
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
}
