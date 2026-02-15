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

// Markus AI Agent types
export interface MarkusSettings {
  llm: {
    apiEndpoint: string
    apiKey: string
    model: string
    maxTokens?: number
    temperature?: number
  }
  search: {
    searxngUrl?: string
    useDuckDuckGo: boolean
  }
  defaultPlanningMode: boolean
  yoloMode: boolean
}

export interface MarkusConversation {
  id: string
  title: string
  workspaceId: string
  messages: MarkusChatMessage[]
  createdAt: number
  updatedAt: number
}

export interface MarkusChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  toolCalls?: MarkusToolCallRecord[]
  isPlan?: boolean
  status: 'pending' | 'streaming' | 'complete' | 'error'
  error?: string
}

export interface MarkusToolCallRecord {
  id: string
  name: string
  arguments: Record<string, unknown>
  status: 'pending' | 'approved' | 'rejected' | 'executing' | 'complete' | 'error'
  result?: unknown
  error?: string
  startedAt: number
  completedAt?: number
}

export interface MarkusConversationListItem {
  id: string
  title: string
  updatedAt: number
  messageCount: number
}

export interface MarkusMemoryProposal {
  id: string
  scope: 'system' | 'project'
  currentContent: string
  proposedContent: string
  diff: string
}

// Multi-agent types
export type MarkusAgentType = 'orchestrator' | 'editor' | 'research' | 'critique' | 'style' | 'creative'
export type MarkusAgentStatus = 'idle' | 'thinking' | 'executing' | 'waiting' | 'error'

export interface MarkusAgentStatusInfo {
  type: MarkusAgentType
  status: MarkusAgentStatus
  details?: string
  currentTask?: string
}

export interface MarkusRAGStatus {
  indexing: boolean
  totalFiles: number
  indexedFiles: number
  totalChunks: number
  lastUpdated: number | null
  error?: string
}

// Task list types
export interface MarkusTask {
  id: string
  description: string
  status: 'pending' | 'in_progress' | 'done' | 'blocked'
  priority: number
  blockedBy?: string
  completedAt?: number
}

export interface MarkusBlockingToolUI {
  type: 'ask_user' | 'approval' | 'consult_boss'
  question?: string
  options?: string[]
  reason?: string
  summary?: string
  filesChanged?: string[]
  message?: string
  messageType?: 'info' | 'success' | 'warning' | 'error' | 'progress'
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
    showFile: (filePath: string) => Promise<{ success: boolean; content?: string | null; error?: string }>
    getConfig: (key: string) => Promise<string | null>
    getCollaborators: () => Promise<string[]>
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
    onToggleWorkspace: (callback: () => void) => () => void
    onAddComment: (callback: () => void) => () => void
    onToggleComments: (callback: () => void) => () => void
    onToggleProgress: (callback: () => void) => () => void
    onOpenSettings: (callback: () => void) => () => void
  }
  explorer: {
    readDirectory: (path: string) => Promise<{ success: boolean; entries?: FileEntry[]; error?: string }>
    openFolder: () => Promise<{ success: boolean; path?: string; error?: string }>
    getGitRoot: (path: string) => Promise<{ success: boolean; gitRoot?: string | null; error?: string }>
    getGitStatus: (gitRoot: string) => Promise<{ success: boolean; files?: GitFileStatus[]; error?: string }>
    getFileDiff: (filePath: string) => Promise<{ success: boolean; hunks?: DiffHunk[]; error?: string }>
    createFile: (filePath: string) => Promise<{ success: boolean; path?: string; error?: string }>
    createDirectory: (dirPath: string) => Promise<{ success: boolean; path?: string; error?: string }>
    saveBinaryFile: (filePath: string, base64Data: string) => Promise<{ success: boolean; path?: string; error?: string }>
    listFiles: (dirPath: string) => Promise<{ success: boolean; files?: string[]; error?: string }>
    copyFile: (sourcePath: string, destPath: string) => Promise<{ success: boolean; path?: string; error?: string }>
    watchDirectory: (path: string) => Promise<{ success: boolean; error?: string }>
    unwatchDirectory: () => Promise<{ success: boolean; error?: string }>
    onDirectoryChanged: (callback: () => void) => () => void
    onOpenFolder: (callback: (data: { path: string }) => void) => () => void
  }
  workspace: {
    save: (name: string, folders: Array<{ path: string; isGitRepo: boolean }>) => Promise<{ success: boolean; path?: string; error?: string }>
    list: () => Promise<{ success: boolean; workspaces: Array<{ name: string; fileName: string; folderCount: number }>; error?: string }>
    load: (fileName: string) => Promise<{ success: boolean; folders?: Array<{ path: string; isGitRepo: boolean }>; error?: string }>
    delete: (fileName: string) => Promise<{ success: boolean; error?: string }>
  }
  markus: {
    // Server URL (provided by embedded server or external)
    getServerUrl: () => Promise<string>

    // Settings
    getSettings: () => Promise<MarkusSettings>
    setSettings: (settings: Partial<MarkusSettings>) => Promise<MarkusSettings>
    openSettings: () => Promise<{ success: boolean; path?: string }>
    validateSettings: () => Promise<{ valid: boolean; errors: string[] }>
    testConnection: () => Promise<{ success: boolean; error?: string }>

    // Conversations
    createConversation: () => Promise<MarkusConversation>
    loadConversation: (conversationId: string) => Promise<MarkusConversation | null>
    loadLatestConversation: () => Promise<MarkusConversation | null>
    saveConversation: (conversation: MarkusConversation) => Promise<{ success: boolean }>
    listConversations: () => Promise<MarkusConversationListItem[]>
    deleteConversation: (conversationId: string) => Promise<boolean>

    // Chat
    sendMessage: (args: {
      conversation: MarkusConversation
      message: string
      planningMode: boolean
      yoloMode: boolean
    }) => Promise<{ success: boolean; conversation?: MarkusConversation; error?: string }>
    cancelRequest: (conversationId: string) => Promise<{ success: boolean; error?: string }>

    // Tool approval
    approveTool: (args: {
      conversationId: string
      toolCallId: string
      approved: boolean
    }) => Promise<{ success: boolean; error?: string }>

    // Memory
    proposeMemoryUpdate: (args: {
      scope: 'system' | 'project'
      action: 'add' | 'update' | 'remove'
      section: string
      content: string
    }) => Promise<MarkusMemoryProposal>
    applyMemoryUpdate: (proposalId: string) => Promise<{ success: boolean; error?: string }>
    rejectMemoryUpdate: (proposalId: string) => Promise<{ success: boolean }>

    // Workspace updates (from renderer to main)
    updateWorkspace: (folders: string[]) => Promise<{ success: boolean }>
    updateOpenFiles: (files: string[]) => Promise<{ success: boolean }>

    // Multi-agent status
    getAgentStatuses: () => Promise<MarkusAgentStatusInfo[]>
    getRAGStatus: () => Promise<MarkusRAGStatus>
    reindexWorkspace: () => Promise<{ success: boolean; error?: string }>

    // Task list (thought loop)
    getTaskList: (conversationId: string) => Promise<MarkusTask[]>
    submitUserResponse: (args: { conversationId: string; response: string }) => Promise<{ success: boolean; error?: string }>
    approveTask: (args: { conversationId: string }) => Promise<{ success: boolean; error?: string }>

    // Events
    onMessageChunk: (callback: (data: { conversationId: string; chunk: string }) => void) => () => void
    onToolCallStarted: (callback: (data: { conversationId: string; toolCall: MarkusToolCallRecord }) => void) => () => void
    onToolCallComplete: (callback: (data: { conversationId: string; toolCallId: string; result: unknown }) => void) => () => void
    onRequestComplete: (callback: (data: { conversationId: string; messageId: string; waitingForInput?: boolean }) => void) => () => void
    onRequestError: (callback: (data: { conversationId: string; error: string }) => void) => () => void
    onToggleAgent: (callback: () => void) => () => void

    // Task list events
    onTasksUpdated: (callback: (data: { conversationId: string; tasks: MarkusTask[] }) => void) => () => void
    onBlockingTool: (callback: (data: { conversationId: string; toolCallId: string; uiData: MarkusBlockingToolUI }) => void) => () => void

    // Multi-agent events
    onAgentStatus: (callback: (data: MarkusAgentStatusInfo) => void) => () => void
    onThinking: (callback: (data: { agent: MarkusAgentType; status: MarkusAgentStatus; details?: string }) => void) => () => void
    onAgentError: (callback: (data: { agent: MarkusAgentType; error: string; taskId?: string }) => void) => () => void
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
    abortMerge: () => ipcRenderer.invoke('git:abortMerge'),
    showFile: (filePath) => ipcRenderer.invoke('git:showFile', filePath),
    getConfig: (key) => ipcRenderer.invoke('git:getConfig', key),
    getCollaborators: () => ipcRenderer.invoke('git:getCollaborators')
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
    onToggleWorkspace: (callback) => {
      const handler = () => callback()
      ipcRenderer.on('menu:toggleWorkspace', handler)
      return () => ipcRenderer.removeListener('menu:toggleWorkspace', handler)
    },
    onAddComment: (callback) => {
      const handler = () => callback()
      ipcRenderer.on('menu:addComment', handler)
      return () => ipcRenderer.removeListener('menu:addComment', handler)
    },
    onToggleComments: (callback) => {
      const handler = () => callback()
      ipcRenderer.on('menu:toggleComments', handler)
      return () => ipcRenderer.removeListener('menu:toggleComments', handler)
    },
    onToggleProgress: (callback) => {
      const handler = () => callback()
      ipcRenderer.on('menu:toggleProgress', handler)
      return () => ipcRenderer.removeListener('menu:toggleProgress', handler)
    },
    onOpenSettings: (callback) => {
      const handler = () => callback()
      ipcRenderer.on('menu:openSettings', handler)
      return () => ipcRenderer.removeListener('menu:openSettings', handler)
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
    saveBinaryFile: (filePath, base64Data) => ipcRenderer.invoke('explorer:saveBinaryFile', filePath, base64Data),
    listFiles: (dirPath) => ipcRenderer.invoke('explorer:listFiles', dirPath),
    copyFile: (sourcePath, destPath) => ipcRenderer.invoke('explorer:copyFile', sourcePath, destPath),
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
  workspace: {
    save: (name, folders) => ipcRenderer.invoke('workspace:save', name, folders),
    list: () => ipcRenderer.invoke('workspace:list'),
    load: (fileName) => ipcRenderer.invoke('workspace:load', fileName),
    delete: (fileName) => ipcRenderer.invoke('workspace:delete', fileName)
  },
  markus: {
    // Server URL
    getServerUrl: () => ipcRenderer.invoke('markus:getServerUrl'),

    // Settings
    getSettings: () => ipcRenderer.invoke('markus:getSettings'),
    setSettings: (settings) => ipcRenderer.invoke('markus:setSettings', settings),
    openSettings: () => ipcRenderer.invoke('markus:openSettings'),
    validateSettings: () => ipcRenderer.invoke('markus:validateSettings'),
    testConnection: () => ipcRenderer.invoke('markus:testConnection'),

    // Conversations
    createConversation: () => ipcRenderer.invoke('markus:createConversation'),
    loadConversation: (conversationId) => ipcRenderer.invoke('markus:loadConversation', conversationId),
    loadLatestConversation: () => ipcRenderer.invoke('markus:loadLatestConversation'),
    saveConversation: (conversation) => ipcRenderer.invoke('markus:saveConversation', conversation),
    listConversations: () => ipcRenderer.invoke('markus:listConversations'),
    deleteConversation: (conversationId) => ipcRenderer.invoke('markus:deleteConversation', conversationId),

    // Chat
    sendMessage: (args) => ipcRenderer.invoke('markus:sendMessage', args),
    cancelRequest: (conversationId) => ipcRenderer.invoke('markus:cancelRequest', conversationId),

    // Tool approval
    approveTool: (args) => ipcRenderer.invoke('markus:approveTool', args),

    // Memory
    proposeMemoryUpdate: (args) => ipcRenderer.invoke('markus:proposeMemoryUpdate', args),
    applyMemoryUpdate: (proposalId) => ipcRenderer.invoke('markus:applyMemoryUpdate', proposalId),
    rejectMemoryUpdate: (proposalId) => ipcRenderer.invoke('markus:rejectMemoryUpdate', proposalId),

    // Workspace updates
    updateWorkspace: (folders) => ipcRenderer.invoke('markus:updateWorkspace', folders),
    updateOpenFiles: (files) => ipcRenderer.invoke('markus:updateOpenFiles', files),

    // Multi-agent status
    getAgentStatuses: () => ipcRenderer.invoke('markus:getAgentStatuses'),
    getRAGStatus: () => ipcRenderer.invoke('markus:getRAGStatus'),
    reindexWorkspace: () => ipcRenderer.invoke('markus:reindexWorkspace'),

    // Task list (thought loop)
    getTaskList: (conversationId) => ipcRenderer.invoke('markus:getTaskList', conversationId),
    submitUserResponse: (args) => ipcRenderer.invoke('markus:submitUserResponse', args),
    approveTask: (args) => ipcRenderer.invoke('markus:approveTask', args),

    // Events
    onMessageChunk: (callback) => {
      const handler = (_: unknown, data: { conversationId: string; chunk: string }) => callback(data)
      ipcRenderer.on('markus:messageChunk', handler)
      return () => ipcRenderer.removeListener('markus:messageChunk', handler)
    },
    onToolCallStarted: (callback) => {
      const handler = (_: unknown, data: { conversationId: string; toolCall: MarkusToolCallRecord }) => callback(data)
      ipcRenderer.on('markus:toolCallStarted', handler)
      return () => ipcRenderer.removeListener('markus:toolCallStarted', handler)
    },
    onToolCallComplete: (callback) => {
      const handler = (_: unknown, data: { conversationId: string; toolCallId: string; result: unknown }) => callback(data)
      ipcRenderer.on('markus:toolCallComplete', handler)
      return () => ipcRenderer.removeListener('markus:toolCallComplete', handler)
    },
    onRequestComplete: (callback) => {
      const handler = (_: unknown, data: { conversationId: string; messageId: string; waitingForInput?: boolean }) => callback(data)
      ipcRenderer.on('markus:requestComplete', handler)
      return () => ipcRenderer.removeListener('markus:requestComplete', handler)
    },
    onRequestError: (callback) => {
      const handler = (_: unknown, data: { conversationId: string; error: string }) => callback(data)
      ipcRenderer.on('markus:requestError', handler)
      return () => ipcRenderer.removeListener('markus:requestError', handler)
    },
    onToggleAgent: (callback) => {
      const handler = () => callback()
      ipcRenderer.on('menu:toggleAgent', handler)
      return () => ipcRenderer.removeListener('menu:toggleAgent', handler)
    },

    // Task list events
    onTasksUpdated: (callback) => {
      const handler = (_: unknown, data: { conversationId: string; tasks: MarkusTask[] }) => callback(data)
      ipcRenderer.on('markus:tasksUpdated', handler)
      return () => ipcRenderer.removeListener('markus:tasksUpdated', handler)
    },
    onBlockingTool: (callback) => {
      const handler = (_: unknown, data: { conversationId: string; toolCallId: string; uiData: MarkusBlockingToolUI }) => callback(data)
      ipcRenderer.on('markus:blockingTool', handler)
      return () => ipcRenderer.removeListener('markus:blockingTool', handler)
    },

    // Multi-agent events
    onAgentStatus: (callback) => {
      const handler = (_: unknown, data: MarkusAgentStatusInfo) => callback(data)
      ipcRenderer.on('markus:agentStatus', handler)
      return () => ipcRenderer.removeListener('markus:agentStatus', handler)
    },
    onThinking: (callback) => {
      const handler = (_: unknown, data: { agent: MarkusAgentType; status: MarkusAgentStatus; details?: string }) => callback(data)
      ipcRenderer.on('markus:thinking', handler)
      return () => ipcRenderer.removeListener('markus:thinking', handler)
    },
    onAgentError: (callback) => {
      const handler = (_: unknown, data: { agent: MarkusAgentType; error: string; taskId?: string }) => callback(data)
      ipcRenderer.on('markus:agentError', handler)
      return () => ipcRenderer.removeListener('markus:agentError', handler)
    }
  }
}

contextBridge.exposeInMainWorld('electron', api)
