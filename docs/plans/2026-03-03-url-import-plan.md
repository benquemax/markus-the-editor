# URL Import Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Import web pages as clean markdown via drag-and-drop, menu, and keyboard shortcut.

**Architecture:** New `urlImporter.ts` module in `electron/converter/` handles URL fetching and conversion using Defuddle. A new IPC channel `converter:importUrl` connects it to the renderer. The renderer gains URL drop detection on both the file tree and editor area, plus a URL input dialog for the menu/shortcut entry point.

**Tech Stack:** Defuddle (article extraction + markdown), Node.js built-in fetch, Electron IPC

**Design doc:** `docs/plans/2026-03-03-url-import-design.md`

---

### Task 1: Install Defuddle dependency

**Files:**
- Modify: `package.json`

**Step 1: Install defuddle**

Run: `npm install defuddle`

**Step 2: Verify installation**

Run: `npm ls defuddle`
Expected: `defuddle@<version>` listed

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: Add defuddle dependency for URL import"
```

---

### Task 2: URL importer module — slug and frontmatter utilities

**Files:**
- Create: `electron/converter/urlImporter.ts`
- Create: `electron/converter/urlImporter.test.ts`

**Step 1: Write failing tests for slug extraction and frontmatter generation**

```typescript
// electron/converter/urlImporter.test.ts
import { describe, it, expect } from 'vitest'
import { extractSlug, generateFrontmatter } from './urlImporter'

describe('extractSlug', () => {
  it('extracts slug from URL path', () => {
    expect(extractSlug('https://example.com/some-article')).toBe('some-article')
  })

  it('extracts last path segment ignoring trailing slash', () => {
    expect(extractSlug('https://example.com/blog/my-post/')).toBe('my-post')
  })

  it('returns null for index pages', () => {
    expect(extractSlug('https://example.com/')).toBeNull()
    expect(extractSlug('https://example.com')).toBeNull()
  })

  it('strips file extensions from slug', () => {
    expect(extractSlug('https://example.com/page.html')).toBe('page')
  })

  it('strips query params and hash', () => {
    expect(extractSlug('https://example.com/article?ref=twitter#section')).toBe('article')
  })
})

describe('generateFrontmatter', () => {
  it('generates frontmatter with all fields', () => {
    const result = generateFrontmatter({
      source: 'https://example.com/article',
      title: 'My Article',
      author: 'John Doe',
      dateImported: '2026-03-03'
    })
    expect(result).toBe(
      '---\nsource: https://example.com/article\ntitle: My Article\nauthor: John Doe\ndate_imported: 2026-03-03\n---\n\n'
    )
  })

  it('omits empty fields', () => {
    const result = generateFrontmatter({
      source: 'https://example.com',
      title: 'Page',
      dateImported: '2026-03-03'
    })
    expect(result).not.toContain('author')
  })

  it('escapes YAML special characters in title', () => {
    const result = generateFrontmatter({
      source: 'https://example.com',
      title: 'Title: With Colon',
      dateImported: '2026-03-03'
    })
    expect(result).toContain('title: "Title: With Colon"')
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run electron/converter/urlImporter.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation of slug extraction and frontmatter generation**

```typescript
// electron/converter/urlImporter.ts
/**
 * URL Importer
 *
 * Fetches web pages by URL and converts them to clean markdown using Defuddle
 * for article extraction. Generates frontmatter with source metadata.
 * Used by the converter IPC handler for all URL import entry points
 * (drag-and-drop, menu, keyboard shortcut).
 */

/**
 * Extracts a URL-safe slug from the last path segment of a URL.
 * Returns null for index pages (no meaningful path).
 */
export function extractSlug(url: string): string | null {
  try {
    const parsed = new URL(url)
    // Remove trailing slash, split path, get last segment
    const segments = parsed.pathname.replace(/\/+$/, '').split('/').filter(Boolean)
    if (segments.length === 0) return null

    let slug = segments[segments.length - 1]
    // Strip file extension (e.g., .html, .php)
    slug = slug.replace(/\.[^.]+$/, '')
    return slug || null
  } catch {
    return null
  }
}

/**
 * Slugifies a title for use as a filename: lowercase, dashes for spaces,
 * strip non-alphanumeric characters.
 */
export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

interface FrontmatterData {
  source: string
  title?: string
  author?: string
  dateImported: string
}

/**
 * Generates YAML frontmatter block from metadata.
 * Only includes fields that have values. Escapes YAML special chars in values.
 */
export function generateFrontmatter(data: FrontmatterData): string {
  const lines: string[] = ['---']

  const escape = (val: string) => {
    // Quote values containing YAML special characters
    if (/[:#{}\[\]&*?|>!@`]/.test(val) || val.startsWith('"') || val.startsWith("'")) {
      return `"${val.replace(/"/g, '\\"')}"`
    }
    return val
  }

  lines.push(`source: ${escape(data.source)}`)
  if (data.title) lines.push(`title: ${escape(data.title)}`)
  if (data.author) lines.push(`author: ${escape(data.author)}`)
  lines.push(`date_imported: ${data.dateImported}`)

  lines.push('---')
  return lines.join('\n') + '\n\n'
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run electron/converter/urlImporter.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add electron/converter/urlImporter.ts electron/converter/urlImporter.test.ts
git commit -m "feat: Add URL slug extraction and frontmatter generation for URL import"
```

---

### Task 3: URL importer module — fetch and convert with Defuddle

**Files:**
- Modify: `electron/converter/urlImporter.ts`
- Modify: `electron/converter/urlImporter.test.ts`

**Step 1: Write failing test for importUrl**

Add to `urlImporter.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { importUrl, extractSlug, generateFrontmatter } from './urlImporter'

// Mock global fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Mock defuddle/node
vi.mock('defuddle/node', () => ({
  Defuddle: vi.fn()
}))

import { Defuddle } from 'defuddle/node'
const mockDefuddle = vi.mocked(Defuddle)

describe('importUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches URL, runs Defuddle, returns markdown with frontmatter', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
      text: () => Promise.resolve('<html><body><h1>Hello</h1><p>World</p></body></html>')
    })
    mockDefuddle.mockResolvedValue({
      markdown: '# Hello\n\nWorld',
      title: 'Hello World',
      author: 'Test Author',
      content: '<h1>Hello</h1><p>World</p>',
      // Other fields Defuddle may return
    } as any)

    const result = await importUrl('https://example.com/hello-world')

    expect(mockFetch).toHaveBeenCalledWith('https://example.com/hello-world', expect.any(Object))
    expect(result.markdown).toContain('source: https://example.com/hello-world')
    expect(result.markdown).toContain('# Hello')
    expect(result.title).toBe('Hello World')
    expect(result.slug).toBe('hello-world')
  })

  it('throws on non-OK response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found'
    })

    await expect(importUrl('https://example.com/missing'))
      .rejects.toThrow('404')
  })

  it('throws on non-HTML response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/pdf' },
      text: () => Promise.resolve('')
    })

    await expect(importUrl('https://example.com/file.pdf'))
      .rejects.toThrow()
  })

  it('uses slugified title when URL has no slug', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
      text: () => Promise.resolve('<html><body>content</body></html>')
    })
    mockDefuddle.mockResolvedValue({
      markdown: 'Content',
      title: 'My Great Page',
      content: 'content',
    } as any)

    const result = await importUrl('https://example.com/')
    expect(result.slug).toBe('my-great-page')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run electron/converter/urlImporter.test.ts`
Expected: FAIL — `importUrl` not exported

**Step 3: Implement importUrl function**

Add to `urlImporter.ts`:

```typescript
export interface ImportUrlResult {
  markdown: string
  title: string
  slug: string
}

/**
 * Fetches a web page and converts it to clean markdown using Defuddle
 * for article extraction. Returns markdown with frontmatter, page title,
 * and a filename slug.
 */
export async function importUrl(url: string): Promise<ImportUrlResult> {
  // Defuddle is ESM-only, so we dynamically import it
  const { Defuddle } = await import('defuddle/node')

  // Fetch the page HTML
  const response = await fetch(url, {
    headers: {
      // Identify as a browser to avoid bot-blocking
      'User-Agent': 'Mozilla/5.0 (compatible; Markus Editor)'
    }
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`)
  }

  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
    throw new Error(`URL did not return HTML (got ${contentType})`)
  }

  const html = await response.text()

  // Run Defuddle for article extraction + markdown conversion
  const result = await Defuddle(html, url, { markdown: true })

  const title = result.title || 'Untitled'
  const slug = extractSlug(url) || slugifyTitle(title)
  const dateImported = new Date().toISOString().split('T')[0]

  const frontmatter = generateFrontmatter({
    source: url,
    title: result.title || undefined,
    author: result.author || undefined,
    dateImported
  })

  const markdown = frontmatter + (result.markdown || '')

  return { markdown, title, slug }
}
```

Note: Defuddle may need dynamic `import()` since it is ESM-only (similar to the existing `pdfjs-dist` pattern in `importers.ts:94`). If the static import in tests works with vitest (which handles ESM natively), keep the mock as-is. The production code should use dynamic import.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run electron/converter/urlImporter.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add electron/converter/urlImporter.ts electron/converter/urlImporter.test.ts
git commit -m "feat: Add importUrl function using Defuddle for webpage-to-markdown conversion"
```

---

### Task 4: IPC handler and preload API

**Files:**
- Modify: `electron/converter/index.ts`
- Modify: `electron/preload.ts`

**Step 1: Add `converter:importUrl` IPC handler**

In `electron/converter/index.ts`, add import at top:

```typescript
import { importUrl } from './urlImporter'
```

Add new handler inside `setupConverterHandlers()`, after the `converter:exportFile` handler (after line 273):

```typescript
  /**
   * Import a web page by URL. Fetches HTML, extracts article content using
   * Defuddle, converts to markdown with frontmatter metadata.
   *
   * When targetDir is provided (folder drop), shows save dialog and writes file.
   * When targetDir is null (editor drop / menu), returns markdown for an unsaved tab.
   */
  ipcMain.handle('converter:importUrl', async (_, url: string, targetDir?: string) => {
    try {
      console.log(`[Converter] Importing URL: ${url}` + (targetDir ? ` → target dir: ${targetDir}` : ''))

      const result = await importUrl(url)

      if (targetDir) {
        // Folder drop flow: save to disk
        const defaultPath = path.join(targetDir, `${result.slug}.md`)

        const saveResult = await showSaveDialog({
          title: 'Save imported page as...',
          defaultPath,
          filters: [
            { name: 'Markdown', extensions: ['md'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        })

        if (saveResult.canceled || !saveResult.filePath) {
          return { success: false, error: 'Cancelled' }
        }

        await fs.writeFile(saveResult.filePath, result.markdown, 'utf-8')
        setCurrentFilePath(saveResult.filePath)

        const mainWindow = getMainWindow()
        if (mainWindow) {
          mainWindow.webContents.send('file:opened', {
            content: result.markdown,
            filePath: saveResult.filePath
          })
        }

        return { success: true, filePath: saveResult.filePath }
      } else {
        // Editor drop / menu flow: return markdown for unsaved tab
        return { success: true, markdown: result.markdown, title: result.title }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error('[Converter] URL import failed:', error instanceof Error ? error.stack || msg : msg)
      await showMessageBox({
        type: 'error',
        title: 'URL Import Failed',
        message: `Could not import page:\n${msg}`
      })
      return { success: false, error: msg }
    }
  })
```

**Step 2: Add preload API**

In `electron/preload.ts`, add to the `converter` interface (alongside existing methods):

```typescript
importUrl: (url: string, targetDir?: string) => Promise<{ success: boolean; markdown?: string; title?: string; filePath?: string; error?: string }>
```

And in the implementation:

```typescript
importUrl: (url, targetDir) => ipcRenderer.invoke('converter:importUrl', url, targetDir),
```

Also add the menu event listener for URL import:

```typescript
onImportUrl: (callback) => {
  const handler = () => callback()
  ipcRenderer.on('menu:importUrl', handler)
  return () => ipcRenderer.removeListener('menu:importUrl', handler)
},
```

And add to the interface:

```typescript
onImportUrl: (callback: () => void) => () => void
```

**Step 3: Run typecheck to verify**

Run: `npx tsc --noEmit`
Expected: PASS (or only pre-existing errors)

**Step 4: Commit**

```bash
git add electron/converter/index.ts electron/preload.ts
git commit -m "feat: Add converter:importUrl IPC handler and preload API"
```

---

### Task 5: Menu item and keyboard shortcut

**Files:**
- Modify: `electron/menu.ts`
- Modify: `electron/main.ts`

**Step 1: Add callback to MenuCallbacks interface**

In `electron/menu.ts`, add to `MenuCallbacks` interface (line 11, after `onImport`):

```typescript
onImportUrl: () => void
```

**Step 2: Add menu item**

In `electron/menu.ts`, after the existing Import menu item (after line 87), add:

```typescript
        {
          label: 'Import from URL...',
          accelerator: 'CmdOrCtrl+Shift+U',
          click: callbacks.onImportUrl
        },
```

**Step 3: Wire callback in main.ts**

In `electron/main.ts`, add to the callbacks object (after line 144, after `onImport`):

```typescript
    onImportUrl: () => mainWindow?.webContents.send('menu:importUrl'),
```

**Step 4: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 5: Commit**

```bash
git add electron/menu.ts electron/main.ts
git commit -m "feat: Add 'Import from URL...' menu item with Ctrl+Shift+U shortcut"
```

---

### Task 6: URL input dialog component

**Files:**
- Create: `src/components/UrlInputDialog.tsx`

**Step 1: Create the URL input dialog**

This is a simple modal dialog with a text input for pasting/typing a URL. Similar in spirit to the command palette but simpler — just a text field and OK/Cancel.

```typescript
// src/components/UrlInputDialog.tsx
/**
 * URL Input Dialog
 *
 * A simple modal dialog for entering a URL to import as markdown.
 * Triggered by the "Import from URL..." menu item or Ctrl+Shift+U.
 * Validates that the input looks like an HTTP(S) URL before accepting.
 */

import { useState, useEffect, useRef } from 'react'

interface UrlInputDialogProps {
  isOpen: boolean
  onSubmit: (url: string) => void
  onClose: () => void
}

export function UrlInputDialog({ isOpen, onSubmit, onClose }: UrlInputDialogProps) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setUrl('')
      setError('')
      // Focus input after dialog renders
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isOpen])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  const handleSubmit = () => {
    const trimmed = url.trim()
    if (!trimmed) return

    // Basic URL validation
    if (!/^https?:\/\/.+/i.test(trimmed)) {
      setError('Please enter a valid URL starting with http:// or https://')
      return
    }

    onSubmit(trimmed)
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-background border border-border rounded-lg shadow-xl w-full max-w-lg p-4"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-sm font-medium mb-3">Import from URL</h3>
        <input
          ref={inputRef}
          type="url"
          value={url}
          onChange={e => { setUrl(e.target.value); setError('') }}
          onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
          placeholder="https://example.com/article"
          className="w-full px-3 py-2 text-sm bg-muted border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary"
        />
        {error && <p className="text-xs text-destructive mt-1">{error}</p>}
        <div className="flex justify-end gap-2 mt-3">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:opacity-90"
          >
            Import
          </button>
        </div>
      </div>
    </div>
  )
}
```

**Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/UrlInputDialog.tsx
git commit -m "feat: Add URL input dialog component for Import from URL"
```

---

### Task 7: Wire up menu/shortcut entry point in App.tsx

**Files:**
- Modify: `src/App.tsx`

**Step 1: Add URL import handler and dialog state**

Add import at top of `src/App.tsx`:

```typescript
import { UrlInputDialog } from './components/UrlInputDialog'
```

Add state for dialog visibility (near other dialog state):

```typescript
const [showUrlImport, setShowUrlImport] = useState(false)
```

Add the URL import handler (near `handleImport` around line 638):

```typescript
  // Handle URL import: fetch webpage, convert to markdown, open as unsaved tab
  const handleImportUrl = useCallback(async (url: string) => {
    setShowUrlImport(false)

    const result = await window.electron.converter.importUrl(url)
    if (result.success && result.markdown) {
      const newTab: Tab = {
        id: `url-import-${Date.now()}`,
        filePath: null,
        title: result.title || 'Imported Page',
        content: result.markdown,
        savedContent: '',
        isDirty: true,
        fileType: 'markdown' as const
      }
      setTabs(prev => [...prev, newTab])
      setActiveTabId(newTab.id)
    }
  }, [])
```

**Step 2: Add menu event listener**

In the `useEffect` that registers menu listeners (around line 649), add:

```typescript
    const unsubImportUrl = window.electron.converter.onImportUrl(() => setShowUrlImport(true))
```

And add `unsubImportUrl()` to the cleanup return.

**Step 3: Add dialog to JSX**

In the render return, add the dialog component (near other dialogs/modals):

```tsx
<UrlInputDialog
  isOpen={showUrlImport}
  onSubmit={handleImportUrl}
  onClose={() => setShowUrlImport(false)}
/>
```

**Step 4: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: Wire up Import from URL menu action with URL input dialog"
```

---

### Task 8: Drag-and-drop URL on editor area

**Files:**
- Modify: `src/App.tsx`

**Step 1: Add URL detection to the document-level drop handler**

In the existing `handleDrop` function inside the drag-and-drop `useEffect` (around line 792), add URL detection before the file handling. The key insight: when dragging a URL from a browser, `dataTransfer` contains `text/uri-list` or `text/plain` with the URL, but the `files` list is empty.

Add this block at the beginning of `handleDrop`, before `const items = Array.from(e.dataTransfer?.files || [])`:

```typescript
      // Check for URL drops (e.g., dragging a link from a browser)
      const droppedUrl = e.dataTransfer?.getData('text/uri-list')
        || e.dataTransfer?.getData('text/plain')
        || ''
      const urlMatch = droppedUrl.trim().split('\n')[0] // text/uri-list can have multiple lines
      if (/^https?:\/\/.+/i.test(urlMatch)) {
        const result = await window.electron.converter.importUrl(urlMatch)
        if (result.success && result.markdown) {
          const newTab: Tab = {
            id: `url-import-${Date.now()}`,
            filePath: null,
            title: result.title || 'Imported Page',
            content: result.markdown,
            savedContent: '',
            isDirty: true,
            fileType: 'markdown' as const
          }
          setTabs(prev => [...prev, newTab])
          setActiveTabId(newTab.id)
        }
        return
      }
```

Note: The `Tab` type and `setTabs`/`setActiveTabId` need to be accessible inside this `useEffect`. Check if the existing effect closure captures them — if not, add them to the dependency array.

**Step 2: Extract shared helper to avoid duplication with Task 7**

Both the menu handler and the drop handler create an unsaved tab from a URL. Extract a shared helper:

```typescript
  // Open a URL import result as a new unsaved tab
  const openUrlAsTab = useCallback((markdown: string, title: string) => {
    const newTab: Tab = {
      id: `url-import-${Date.now()}`,
      filePath: null,
      title,
      content: markdown,
      savedContent: '',
      isDirty: true,
      fileType: 'markdown' as const
    }
    setTabs(prev => [...prev, newTab])
    setActiveTabId(newTab.id)
  }, [])
```

Then use it in both `handleImportUrl` and the drop handler.

**Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat: Handle URL drag-and-drop on editor area to import as markdown"
```

---

### Task 9: Drag-and-drop URL on file tree folder

**Files:**
- Modify: `src/components/FileExplorer/FileTreeItem.tsx`

**Step 1: Add URL detection to FileTreeItem drop handler**

In the existing `handleDrop` function (around line 135), add URL detection before the file loop. When a URL is dropped on a folder, call `converter:importUrl` with the folder path as `targetDir`:

```typescript
    // Check for URL drops (e.g., dragging a link from a browser)
    const droppedUrl = e.dataTransfer?.getData('text/uri-list')
      || e.dataTransfer?.getData('text/plain')
      || ''
    const urlMatch = droppedUrl.trim().split('\n')[0]
    if (/^https?:\/\/.+/i.test(urlMatch)) {
      // Import URL to this folder — main process handles save dialog
      await window.electron.converter.importUrl(urlMatch, node.path)
      onFileDrop?.(node.path)
      return
    }
```

This goes right after `setIsDragOver(false)` and before `const IMPORTABLE_EXTENSIONS = ...`.

The main process handler (Task 4) already shows the save dialog with the slug-based filename when `targetDir` is provided, and sends `file:opened` to open the result.

**Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/FileExplorer/FileTreeItem.tsx
git commit -m "feat: Handle URL drag-and-drop on file tree folders to import as markdown"
```

---

### Task 10: Final verification

**Step 1: Run all tests**

Run: `npm test`
Expected: All tests PASS

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 3: Run linter**

Run: `npm run lint`
Expected: PASS (or only pre-existing warnings)

**Step 4: Run build**

Run: `npm run build`
Expected: Build succeeds

**Step 5: Commit any fixes if needed, then final commit**

```bash
git add -A
git commit -m "feat: URL import — import web pages as markdown via drag-and-drop, menu, and shortcut"
```
