import { Menu, BrowserWindow, app, shell } from 'electron'

interface MenuCallbacks {
  onNewWindow: () => void
  onNewTab: () => void
  onOpenFile: () => void
  onOpenFolder: () => void
  onSaveFile: () => void
  onSaveAsFile: () => void
  onPrintToPdf: () => void
  onImport: () => void
  onImportUrl: () => void
  onExportDocx: () => void
  onExportOdt: () => void
  onExportHtml: () => void
  getRecentFiles: () => string[]
  onOpenRecentFile: (filePath: string) => void
  onClearRecentFiles: () => void
}

export function createMenu(window: BrowserWindow, callbacks: MenuCallbacks): Menu {
  const isMac = process.platform === 'darwin'

  const recentFiles = callbacks.getRecentFiles()
  const recentFilesMenu = recentFiles.length > 0
    ? [
        ...recentFiles.map(file => ({
          label: file,
          click: () => callbacks.onOpenRecentFile(file)
        })),
        { type: 'separator' as const },
        {
          label: 'Clear Recent',
          click: callbacks.onClearRecentFiles
        }
      ]
    : [{ label: 'No Recent Files', enabled: false }]

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' as const },
            { type: 'separator' as const },
            { role: 'services' as const },
            { type: 'separator' as const },
            { role: 'hide' as const },
            { role: 'hideOthers' as const },
            { role: 'unhide' as const },
            { type: 'separator' as const },
            { role: 'quit' as const }
          ]
        }]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+N',
          click: callbacks.onNewWindow
        },
        {
          label: 'New Tab',
          accelerator: 'CmdOrCtrl+T',
          click: callbacks.onNewTab
        },
        { type: 'separator' },
        {
          label: 'Open...',
          accelerator: 'CmdOrCtrl+O',
          click: callbacks.onOpenFile
        },
        {
          label: 'Open Folder...',
          accelerator: 'CmdOrCtrl+Shift+A',
          click: callbacks.onOpenFolder
        },
        {
          label: 'Open Recent',
          submenu: recentFilesMenu
        },
        {
          label: 'Import...',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: callbacks.onImport
        },
        {
          label: 'Import from URL...',
          accelerator: 'CmdOrCtrl+Shift+U',
          click: callbacks.onImportUrl
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: callbacks.onSaveFile
        },
        {
          label: 'Save As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: callbacks.onSaveAsFile
        },
        { type: 'separator' },
        {
          label: 'Export',
          submenu: [
            {
              label: 'PDF...',
              accelerator: 'CmdOrCtrl+Shift+E',
              click: callbacks.onPrintToPdf
            },
            {
              label: 'Word Document...',
              click: callbacks.onExportDocx
            },
            {
              label: 'OpenDocument...',
              click: callbacks.onExportOdt
            },
            {
              label: 'HTML...',
              click: callbacks.onExportHtml
            }
          ]
        },
        { type: 'separator' },
        isMac ? { role: 'close' as const } : { role: 'quit' as const }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' as const },
              { role: 'delete' as const },
              { role: 'selectAll' as const }
            ]
          : [
              { role: 'delete' as const },
              { type: 'separator' as const },
              { role: 'selectAll' as const }
            ]),
        { type: 'separator' as const },
        {
          label: 'Add Comment',
          accelerator: 'CmdOrCtrl+Alt+M',
          click: () => window.webContents.send('menu:addComment')
        },
        ...(isMac
          ? [{
              label: 'Settings...',
              accelerator: 'CmdOrCtrl+,',
              click: () => window.webContents.send('menu:openSettings')
            }]
          : [{
              label: 'Settings',
              accelerator: 'CmdOrCtrl+,',
              click: () => window.webContents.send('menu:openSettings')
            }])
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Workspace',
          accelerator: 'CmdOrCtrl+B',
          click: () => window.webContents.send('menu:toggleWorkspace')
        },
        {
          label: 'Toggle Agent',
          accelerator: 'CmdOrCtrl+M',
          click: () => window.webContents.send('menu:toggleAgent')
        },
        {
          label: 'Toggle Terminal',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: () => window.webContents.send('menu:toggleTerminal')
        },
        {
          label: 'Toggle Split View',
          accelerator: 'CmdOrCtrl+\\',
          click: () => window.webContents.send('menu:toggleSplitView')
        },
        {
          label: 'Toggle Comments',
          click: () => window.webContents.send('menu:toggleComments')
        },
        {
          label: 'Show Edits',
          accelerator: 'CmdOrCtrl+Shift+D',
          click: () => window.webContents.send('menu:toggleShowEdits')
        },
        { type: 'separator' },
        {
          label: 'Theme',
          submenu: [
            {
              label: 'Light',
              type: 'radio',
              click: () => window.webContents.send('menu:toggleTheme', 'light')
            },
            {
              label: 'Dark',
              type: 'radio',
              click: () => window.webContents.send('menu:toggleTheme', 'dark')
            },
            {
              label: 'System',
              type: 'radio',
              checked: true,
              click: () => window.webContents.send('menu:toggleTheme', 'system')
            }
          ]
        },
        { type: 'separator' },
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        { role: 'toggleDevTools' as const },
        { type: 'separator' },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' },
        { role: 'togglefullscreen' as const }
      ]
    },
    {
      label: 'Go',
      submenu: [
        {
          label: 'Command Palette',
          accelerator: 'CmdOrCtrl+P',
          click: () => window.webContents.send('menu:openCommandPalette')
        }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Markus',
          click: async () => {
            const { dialog } = await import('electron')
            dialog.showMessageBox(window, {
              type: 'info',
              title: 'About Markus',
              message: 'Markus - WYSIWYG Markdown Editor',
              detail: 'Version 0.1.0\n\nA local markdown editor built with Electron, React, and ProseMirror.'
            })
          }
        },
        {
          label: 'Learn More',
          click: () => shell.openExternal('https://github.com')
        }
      ]
    }
  ]

  return Menu.buildFromTemplate(template)
}
