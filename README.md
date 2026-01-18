# Markus - WYSIWYG Markdown Editor

A local, cross-platform WYSIWYG markdown editor built with Electron, React, and ProseMirror.

## Features

- **WYSIWYG Editing**: Edit markdown visually with real-time formatting
- **Markdown Input Rules**: Type `# ` for headings, `- ` or `* ` for bullet lists, `1. ` for numbered lists, `> ` for blockquotes, ``` for code blocks
- **Keyboard Shortcuts**: `Ctrl+B` bold, `Ctrl+I` italic, `Ctrl+`` code, and more
- **Slash Commands**: Type `/` to access formatting options quickly
- **Split View**: Toggle markdown preview alongside the editor
- **File Operations**: Open, save, and create markdown files
- **Git Integration**: View git status, commit changes, pull/push from the editor
- **Command Palette**: Quick access to all commands via `Ctrl+P`
- **Themes**: Light, dark, and system theme support
- **PDF Export**: Export your documents to PDF
- **External File Watching**: Detects changes made to files outside the editor

## Tech Stack

- **Electron 28+** - Desktop application shell
- **React 18** - UI framework
- **ProseMirror** - Rich text editing engine
- **TypeScript** - Type safety
- **Vite** - Build tooling
- **Tailwind CSS** - Styling

## Development

### Prerequisites

- Node.js 18+
- npm or pnpm

### Setup

```bash
npm install
```

### Run in Development

```bash
npm run dev:full
```

This starts the Vite dev server and Electron together.

### Build

```bash
npm run build
```

### Package for Distribution

```bash
npm run dist
```

Creates distributable packages for your platform (AppImage, deb, pacman on Linux; dmg on macOS; nsis on Windows).

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+S` | Save |
| `Ctrl+Shift+S` | Save As |
| `Ctrl+O` | Open |
| `Ctrl+N` | New File |
| `Ctrl+B` | Bold |
| `Ctrl+I` | Italic |
| `Ctrl+`` | Inline Code |
| `Ctrl+Shift+S` | Strikethrough |
| `Ctrl+Alt+1-6` | Heading 1-6 |
| `Ctrl+Shift+C` | Code Block |
| `Ctrl+Shift+>` | Blockquote |
| `Ctrl+P` | Command Palette |
| `Ctrl+\` | Toggle Split View |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` / `Ctrl+Shift+Z` | Redo |
| `Tab` | Indent list item |
| `Shift+Tab` | Outdent list item |

## License

MIT
