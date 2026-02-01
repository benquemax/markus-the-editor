import { contextBridge, ipcRenderer } from 'electron'

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

export interface ElectronAPI {
  file: {
    save: (content: string) => Promise<{ success: boolean; filePath?: string; error?: string }>
    saveAs: (content: string) => Promise<{ success: boolean; filePath?: string; error?: string }>
    open: () => Promise<void>
    openPath: (path: string) => Promise<{ success: boolean; error?: string }>
    readBinary: (path: string) => Promise<{ success: boolean; data?: string; error?: string }>
    getCurrentPath: () => Promise<string | null>
    onNew: (callback: () => void) => () => void
    onOpened: (callback: (data: { content: string; filePath: string }) => void) => () => void
    onBinaryOpened: (callback: (data: { data: string; filePath: string }) => void) => () => void
    onRequestContent: (callback: () => void) => () => void
    onExternalChange: (callback: (data: { content: string }) => void) => () => void
  }
  dialog: {
    showMessage: (options: {
      type: string
      title: string
      message: string
      buttons: string[]
    }) => Promise<{ response: number }>
  }
  store: {
    get: (key: string) => Promise<unknown>
    set: (key: string, value: unknown) => Promise<void>
  }
  git: {
    isRepo: () => Promise<boolean>
    isRepoAtPath: (folderPath: string) => Promise<boolean>
    status: () => Promise<{
      current: string | null
      tracking: string | null
      files: Array<{ path: string; index: string; working_dir: string }>
      ahead: number
      behind: number
    }>
    branches: () => Promise<{
      all: string[]
      current: string
    }>
    checkout: (branch: string) => Promise<{ success: boolean; error?: string }>
    pull: () => Promise<{ success: boolean; error?: string }>
    commit: (message: string) => Promise<{ success: boolean; error?: string }>
    push: () => Promise<{ success: boolean; error?: string }>
    add: (files: string[]) => Promise<{ success: boolean; error?: string }>
    addAll: () => Promise<{ success: boolean; error?: string }>
    stash: () => Promise<{ success: boolean; error?: string }>
    stashPop: () => Promise<{ success: boolean; error?: string }>
    fetch: () => Promise<{ success: boolean; error?: string }>
    pushWithConflictHandling: () => Promise<{
      success: boolean
      content?: string
      hasConflicts: boolean
      error?: string
    }>
    pullWithConflictDetection: () => Promise<{
      success: boolean
      content?: string
      hasConflicts: boolean
      error?: string
    }>
    readCurrentFile: () => Promise<{ success: boolean; content?: string; error?: string }>
    writeResolution: (content: string) => Promise<{ success: boolean; error?: string }>
    abortMerge: () => Promise<{ success: boolean; error?: string }>
  }
  ai: {
    getSettings: () => Promise<{
      enabled: boolean
      apiEndpoint: string
      apiKey: string
      model: string
    }>
    setSettings: (settings: Partial<{
      enabled: boolean
      apiEndpoint: string
      apiKey: string
      model: string
    }>) => Promise<{
      enabled: boolean
      apiEndpoint: string
      apiKey: string
      model: string
    }>
    testConnection: () => Promise<{ success: boolean; error?: string }>
    merge: (localContent: string, remoteContent: string) => Promise<{
      success: boolean
      merged?: string
      error?: string
    }>
  }
  shell: {
    openExternal: (url: string) => Promise<void>
  }
  menu: {
    onToggleTheme: (callback: (theme: 'light' | 'dark' | 'system') => void) => () => void
    onToggleSplitView: (callback: () => void) => () => void
    onOpenCommandPalette: (callback: () => void) => () => void
    onToggleExplorer: (callback: () => void) => () => void
  }
  explorer: {
    readDirectory: (path: string) => Promise<{ success: boolean; entries?: FileEntry[]; error?: string }>
    openFolder: () => Promise<{ success: boolean; path?: string; error?: string }>
    getGitRoot: (path: string) => Promise<{ success: boolean; gitRoot?: string | null; error?: string }>
    getGitStatus: (gitRoot: string) => Promise<{ success: boolean; files?: GitFileStatus[]; error?: string }>
    getFileDiff: (filePath: string) => Promise<{ success: boolean; hunks?: DiffHunk[]; error?: string }>
    createFile: (filePath: string) => Promise<{ success: boolean; path?: string; error?: string }>
    createDirectory: (dirPath: string) => Promise<{ success: boolean; path?: string; error?: string }>
    watchDirectory: (path: string) => Promise<{ success: boolean; error?: string }>
    unwatchDirectory: () => Promise<{ success: boolean; error?: string }>
    onDirectoryChanged: (callback: () => void) => () => void
    onOpenFolder: (callback: (data: { path: string }) => void) => () => void
  }
  filebar: {
    save: (name: string, folders: Array<{ path: string; isGitRepo: boolean }>) => Promise<{ success: boolean; path?: string; error?: string }>
    list: () => Promise<{ success: boolean; filebars: Array<{ name: string; fileName: string; folderCount: number }>; error?: string }>
    load: (fileName: string) => Promise<{ success: boolean; folders?: Array<{ path: string; isGitRepo: boolean }>; error?: string }>
    delete: (fileName: string) => Promise<{ success: boolean; error?: string }>
  }
}

const api: ElectronAPI = {
  file: {
    save: (content) => ipcRenderer.invoke('file:save', content),
    saveAs: (content) => ipcRenderer.invoke('file:saveAs', content),
    open: () => ipcRenderer.invoke('file:open'),
    openPath: (path) => ipcRenderer.invoke('file:openPath', path),
    readBinary: (path) => ipcRenderer.invoke('file:readBinary', path),
    getCurrentPath: () => ipcRenderer.invoke('file:getCurrentPath'),
    onNew: (callback) => {
      const handler = () => callback()
      ipcRenderer.on('file:new', handler)
      return () => ipcRenderer.removeListener('file:new', handler)
    },
    onOpened: (callback) => {
      const handler = (_: unknown, data: { content: string; filePath: string }) => callback(data)
      ipcRenderer.on('file:opened', handler)
      return () => ipcRenderer.removeListener('file:opened', handler)
    },
    onBinaryOpened: (callback) => {
      const handler = (_: unknown, data: { data: string; filePath: string }) => callback(data)
      ipcRenderer.on('file:binaryOpened', handler)
      return () => ipcRenderer.removeListener('file:binaryOpened', handler)
    },
    onRequestContent: (callback) => {
      const handler = () => callback()
      ipcRenderer.on('file:requestContent', handler)
      return () => ipcRenderer.removeListener('file:requestContent', handler)
    },
    onExternalChange: (callback) => {
      const handler = (_: unknown, data: { content: string }) => callback(data)
      ipcRenderer.on('file:externalChange', handler)
      return () => ipcRenderer.removeListener('file:externalChange', handler)
    }
  },
  dialog: {
    showMessage: (options) => ipcRenderer.invoke('dialog:showMessage', options)
  },
  store: {
    get: (key) => ipcRenderer.invoke('store:get', key),
    set: (key, value) => ipcRenderer.invoke('store:set', key, value)
  },
  git: {
    isRepo: () => ipcRenderer.invoke('git:isRepo'),
    isRepoAtPath: (folderPath) => ipcRenderer.invoke('git:isRepoAtPath', folderPath),
    status: () => ipcRenderer.invoke('git:status'),
    branches: () => ipcRenderer.invoke('git:branches'),
    checkout: (branch) => ipcRenderer.invoke('git:checkout', branch),
    pull: () => ipcRenderer.invoke('git:pull'),
    commit: (message) => ipcRenderer.invoke('git:commit', message),
    push: () => ipcRenderer.invoke('git:push'),
    add: (files) => ipcRenderer.invoke('git:add', files),
    addAll: () => ipcRenderer.invoke('git:addAll'),
    stash: () => ipcRenderer.invoke('git:stash'),
    stashPop: () => ipcRenderer.invoke('git:stashPop'),
    fetch: () => ipcRenderer.invoke('git:fetch'),
    pushWithConflictHandling: () => ipcRenderer.invoke('git:pushWithConflictHandling'),
    pullWithConflictDetection: () => ipcRenderer.invoke('git:pullWithConflictDetection'),
    readCurrentFile: () => ipcRenderer.invoke('git:readCurrentFile'),
    writeResolution: (content) => ipcRenderer.invoke('git:writeResolution', content),
    abortMerge: () => ipcRenderer.invoke('git:abortMerge')
  },
  ai: {
    getSettings: () => ipcRenderer.invoke('ai:getSettings'),
    setSettings: (settings) => ipcRenderer.invoke('ai:setSettings', settings),
    testConnection: () => ipcRenderer.invoke('ai:testConnection'),
    merge: (localContent, remoteContent) => ipcRenderer.invoke('ai:merge', localContent, remoteContent)
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url)
  },
  menu: {
    onToggleTheme: (callback) => {
      const handler = (_: unknown, theme: 'light' | 'dark' | 'system') => callback(theme)
      ipcRenderer.on('menu:toggleTheme', handler)
      return () => ipcRenderer.removeListener('menu:toggleTheme', handler)
    },
    onToggleSplitView: (callback) => {
      const handler = () => callback()
      ipcRenderer.on('menu:toggleSplitView', handler)
      return () => ipcRenderer.removeListener('menu:toggleSplitView', handler)
    },
    onOpenCommandPalette: (callback) => {
      const handler = () => callback()
      ipcRenderer.on('menu:openCommandPalette', handler)
      return () => ipcRenderer.removeListener('menu:openCommandPalette', handler)
    },
    onToggleExplorer: (callback) => {
      const handler = () => callback()
      ipcRenderer.on('menu:toggleExplorer', handler)
      return () => ipcRenderer.removeListener('menu:toggleExplorer', handler)
    }
  },
  explorer: {
    readDirectory: (path) => ipcRenderer.invoke('explorer:readDirectory', path),
    openFolder: () => ipcRenderer.invoke('explorer:openFolder'),
    getGitRoot: (path) => ipcRenderer.invoke('explorer:getGitRoot', path),
    getGitStatus: (gitRoot) => ipcRenderer.invoke('explorer:getGitStatus', gitRoot),
    getFileDiff: (filePath) => ipcRenderer.invoke('explorer:getFileDiff', filePath),
    createFile: (filePath) => ipcRenderer.invoke('explorer:createFile', filePath),
    createDirectory: (dirPath) => ipcRenderer.invoke('explorer:createDirectory', dirPath),
    watchDirectory: (path) => ipcRenderer.invoke('explorer:watchDirectory', path),
    unwatchDirectory: () => ipcRenderer.invoke('explorer:unwatchDirectory'),
    onDirectoryChanged: (callback) => {
      const handler = () => callback()
      ipcRenderer.on('explorer:directoryChanged', handler)
      return () => ipcRenderer.removeListener('explorer:directoryChanged', handler)
    },
    onOpenFolder: (callback) => {
      const handler = (_: unknown, data: { path: string }) => callback(data)
      ipcRenderer.on('explorer:openFolder', handler)
      return () => ipcRenderer.removeListener('explorer:openFolder', handler)
    }
  },
  filebar: {
    save: (name, folders) => ipcRenderer.invoke('filebar:save', name, folders),
    list: () => ipcRenderer.invoke('filebar:list'),
    load: (fileName) => ipcRenderer.invoke('filebar:load', fileName),
    delete: (fileName) => ipcRenderer.invoke('filebar:delete', fileName)
  }
}

contextBridge.exposeInMainWorld('electron', api)
