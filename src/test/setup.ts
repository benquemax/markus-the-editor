import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Mock window.electron for tests
const mockElectron = {
  file: {
    save: vi.fn().mockResolvedValue({ success: true }),
    saveAs: vi.fn().mockResolvedValue({ success: true }),
    open: vi.fn().mockResolvedValue(undefined),
    openPath: vi.fn().mockResolvedValue({ success: true }),
    getCurrentPath: vi.fn().mockResolvedValue(null),
    onNew: vi.fn().mockReturnValue(() => {}),
    onOpened: vi.fn().mockReturnValue(() => {}),
    onRequestContent: vi.fn().mockReturnValue(() => {}),
    onExternalChange: vi.fn().mockReturnValue(() => {})
  },
  dialog: {
    showMessage: vi.fn().mockResolvedValue({ response: 0 })
  },
  store: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined)
  },
  git: {
    isRepo: vi.fn().mockResolvedValue(false),
    status: vi.fn().mockResolvedValue({
      current: 'main',
      tracking: 'origin/main',
      files: [],
      ahead: 0,
      behind: 0
    }),
    branches: vi.fn().mockResolvedValue({
      all: ['main'],
      current: 'main'
    }),
    checkout: vi.fn().mockResolvedValue({ success: true }),
    pull: vi.fn().mockResolvedValue({ success: true }),
    commit: vi.fn().mockResolvedValue({ success: true }),
    push: vi.fn().mockResolvedValue({ success: true }),
    add: vi.fn().mockResolvedValue({ success: true })
  },
  shell: {
    openExternal: vi.fn().mockResolvedValue(undefined)
  },
  menu: {
    onToggleTheme: vi.fn().mockReturnValue(() => {}),
    onToggleSplitView: vi.fn().mockReturnValue(() => {}),
    onOpenCommandPalette: vi.fn().mockReturnValue(() => {})
  }
}

// @ts-expect-error - mock
globalThis.window = {
  ...globalThis.window,
  electron: mockElectron
}

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  }))
})
