import { contextBridge, ipcRenderer } from 'electron'

export interface ElectronAPI {
  file: {
    save: (content: string) => Promise<{ success: boolean; filePath?: string; error?: string }>
    saveAs: (content: string) => Promise<{ success: boolean; filePath?: string; error?: string }>
    open: () => Promise<void>
    openPath: (path: string) => Promise<{ success: boolean; error?: string }>
    getCurrentPath: () => Promise<string | null>
    onNew: (callback: () => void) => () => void
    onOpened: (callback: (data: { content: string; filePath: string }) => void) => () => void
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
  }
  shell: {
    openExternal: (url: string) => Promise<void>
  }
  menu: {
    onToggleTheme: (callback: (theme: 'light' | 'dark' | 'system') => void) => () => void
    onToggleSplitView: (callback: () => void) => () => void
    onOpenCommandPalette: (callback: () => void) => () => void
  }
  image: {
    save: (options: {
      imageName: string
      imageData: string
      mimeType: string
    }) => Promise<{
      success: boolean
      relativePath?: string
      isTemp?: boolean
      absolutePath?: string
      error?: string
    }>
    listExisting: (pattern?: string) => Promise<{
      success: boolean
      files: string[]
      error?: string
    }>
    moveFromTemp: (options: {
      tempPaths: string[]
      targetDocPath: string
    }) => Promise<{
      success: boolean
      pathMap: Record<string, string>
      error?: string
    }>
    getFolderPath: () => Promise<{
      folder: string
      isTemp: boolean
      docPath: string | null
    }>
  }
}

const api: ElectronAPI = {
  file: {
    save: (content) => ipcRenderer.invoke('file:save', content),
    saveAs: (content) => ipcRenderer.invoke('file:saveAs', content),
    open: () => ipcRenderer.invoke('file:open'),
    openPath: (path) => ipcRenderer.invoke('file:openPath', path),
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
    status: () => ipcRenderer.invoke('git:status'),
    branches: () => ipcRenderer.invoke('git:branches'),
    checkout: (branch) => ipcRenderer.invoke('git:checkout', branch),
    pull: () => ipcRenderer.invoke('git:pull'),
    commit: (message) => ipcRenderer.invoke('git:commit', message),
    push: () => ipcRenderer.invoke('git:push'),
    add: (files) => ipcRenderer.invoke('git:add', files)
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
    }
  },
  image: {
    save: (options) => ipcRenderer.invoke('image:save', options),
    listExisting: (pattern) => ipcRenderer.invoke('image:listExisting', pattern),
    moveFromTemp: (options) => ipcRenderer.invoke('image:moveFromTemp', options),
    getFolderPath: () => ipcRenderer.invoke('image:getFolderPath')
  }
}

contextBridge.exposeInMainWorld('electron', api)
