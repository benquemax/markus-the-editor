import { Menu, BrowserWindow, app, shell } from 'electron'

interface MenuCallbacks {
  onNewWindow: () => void
  onNewTab: () => void
  onOpenFile: () => void
  onOpenFolder: () => void
  onSaveFile: () => void
  onSaveAsFile: () => void
  onPrintToPdf: () => void
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
          click: callbacks.onOpenFolder
        },
        {
          label: 'Open Recent',
          submenu: recentFilesMenu
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
          label: 'Export to PDF...',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: callbacks.onPrintToPdf
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
            ])
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Explorer',
          accelerator: 'CmdOrCtrl+B',
          click: () => window.webContents.send('menu:toggleExplorer')
        },
        {
          label: 'Toggle Split View',
          accelerator: 'CmdOrCtrl+\\',
          click: () => window.webContents.send('menu:toggleSplitView')
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
