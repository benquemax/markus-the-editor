# URL Import: Web Page to Markdown

## Summary

Import web pages into Markus by URL, converting them to clean markdown using article extraction. Three entry points: drag-and-drop on folder (saves file), drag-and-drop on editor (unsaved tab), and menu/keyboard shortcut (unsaved tab).

## Entry Points

### 1. Drag-and-drop on folder (file tree)
- Drop a URL onto a folder in the sidebar
- Conversion runs, then save dialog appears with pre-filled filename (selected so typing replaces it)
- Filename: URL slug if available, otherwise page title slugified (lowercase, dashes, no spaces), `.md` extension
- File saves to target folder and opens in new tab

### 2. Drag-and-drop on editor area
- Drop a URL onto the editor
- Conversion runs, result opens as new unsaved tab
- Tab title is the page title

### 3. Menu / keyboard shortcut
- `File > Import from URL...` with `Ctrl+Shift+U`
- Shows URL input dialog
- Conversion runs, result opens as new unsaved tab

## Conversion Pipeline

All processing in the Electron main process via new `converter:importUrl` IPC handler:

```
URL string
  -> fetch HTML (Node.js built-in fetch)
  -> Defuddle(html, url, { markdown: true })
  -> Extract: markdown, title, author, description, domain
  -> Prepend frontmatter (only non-empty fields):
      ---
      source: https://example.com/article
      title: Article Title
      author: Author Name
      date_imported: 2026-03-03
      ---
  -> Return { markdown, title, slug } to renderer
```

### Conversion library

**Defuddle** (`defuddle/node`) - created by Steph Ango (Obsidian creator) for Obsidian Web Clipper:
- Single library: article extraction + markdown conversion built-in
- Multi-pass extraction algorithm, more forgiving than Mozilla Readability
- Rich metadata: title, author, description, domain, word count, schema.org
- Uses Turndown internally (consistent with existing HTML importer)
- Pure JS, no native dependencies, Electron-friendly

### Decisions
- Images: kept as remote URLs (no local download)
- Frontmatter: included with source URL, title, author (if detected), import date
- Content scope: article extraction only (no nav, ads, sidebars)

## Filename Generation

1. Extract slug from URL path (e.g., `https://example.com/some-article` -> `some-article`)
2. If no slug (index page), slugify the page title (lowercase, spaces -> dashes, strip special chars)
3. Extension: `.md`
4. Save dialog shows filename pre-filled and fully selected

## UX Details

### Loading state
Open new tab immediately with loading placeholder, replace content when conversion completes.

### Error handling
Network failures, 404s, timeouts, non-HTML responses surface as error dialogs via existing `showMessageBox` helper. No partial content.

### Drag detection
URL drops detected via `text/uri-list` or `text/plain` matching URL pattern (`http://` or `https://`).

### Visual feedback
- Folder drop: existing `ring-2 ring-primary` highlight
- Editor drop: visual indicator for "drop to import"

## File Changes

### New files
- `electron/converter/urlImporter.ts` - URL fetch + Defuddle conversion
- `electron/converter/urlImporter.test.ts` - tests (mock fetch, frontmatter, slug extraction)

### Modified files
- `electron/converter/index.ts` - register `converter:importUrl` IPC handler
- `electron/menu.ts` - add "Import from URL..." menu item (`Ctrl+Shift+U`)
- `electron/preload.ts` - expose new IPC channel
- `src/components/FileExplorer/FileTreeItem.tsx` - extend drop handler to detect URLs
- `src/App.tsx` - menu event handler, editor URL drop, URL input dialog
- `src/editor/plugins/` - URL drop detection at editor level

### New dependency
- `defuddle` (npm)
