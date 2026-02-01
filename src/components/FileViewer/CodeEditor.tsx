/**
 * CodeEditor Component
 *
 * Monaco-based code editor for files that don't have a specialized viewer.
 * Automatically detects language from file extension for syntax highlighting.
 */

import { useEffect, useRef, useCallback } from 'react'
import Editor, { OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'

interface CodeEditorProps {
  content: string
  filePath: string | null
  onChange: (content: string) => void
  onSave?: () => void
}

/**
 * Maps file extensions to Monaco language identifiers.
 */
function getLanguageFromPath(filePath: string | null): string {
  if (!filePath) return 'plaintext'

  const ext = filePath.split('.').pop()?.toLowerCase() || ''

  const languageMap: Record<string, string> = {
    // Web
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    css: 'css',
    scss: 'scss',
    less: 'less',
    html: 'html',
    htm: 'html',

    // Data formats
    json: 'json',
    xml: 'xml',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'ini',

    // Config files
    ini: 'ini',
    conf: 'ini',
    cfg: 'ini',
    env: 'ini',

    // Programming languages
    py: 'python',
    rb: 'ruby',
    rs: 'rust',
    go: 'go',
    java: 'java',
    kt: 'kotlin',
    kts: 'kotlin',
    scala: 'scala',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    hpp: 'cpp',
    cs: 'csharp',
    swift: 'swift',
    m: 'objective-c',
    mm: 'objective-c',
    php: 'php',
    pl: 'perl',
    lua: 'lua',
    r: 'r',
    sql: 'sql',

    // Shell
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    fish: 'shell',
    ps1: 'powershell',

    // Markup
    md: 'markdown',
    markdown: 'markdown',
    tex: 'latex',
    rst: 'restructuredtext',

    // Other
    dockerfile: 'dockerfile',
    makefile: 'makefile',
    cmake: 'cmake',
    diff: 'diff',
    patch: 'diff',
    log: 'plaintext',
    txt: 'plaintext'
  }

  // Handle special filenames
  const filename = filePath.split('/').pop()?.toLowerCase() || ''
  if (filename === 'dockerfile') return 'dockerfile'
  if (filename === 'makefile' || filename === 'gnumakefile') return 'makefile'
  if (filename === 'cmakelists.txt') return 'cmake'
  if (filename.startsWith('.env')) return 'ini'
  if (filename === '.gitignore' || filename === '.dockerignore') return 'ini'

  return languageMap[ext] || 'plaintext'
}

export function CodeEditor({ content, filePath, onChange, onSave }: CodeEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)

  // Detect if we're in dark mode
  const isDarkMode = document.documentElement.classList.contains('dark')
  const language = getLanguageFromPath(filePath)

  const handleEditorDidMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor

    // Add Ctrl+S keybinding for save
    if (onSave) {
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        onSave()
      })
    }

    // Focus the editor
    editor.focus()
  }, [onSave])

  const handleChange = useCallback((value: string | undefined) => {
    onChange(value || '')
  }, [onChange])

  // Update content when tab changes
  useEffect(() => {
    if (editorRef.current) {
      const currentValue = editorRef.current.getValue()
      if (currentValue !== content) {
        editorRef.current.setValue(content)
      }
    }
  }, [content])

  return (
    <div className="h-full">
      <Editor
        height="100%"
        language={language}
        value={content}
        theme={isDarkMode ? 'vs-dark' : 'light'}
        onChange={handleChange}
        onMount={handleEditorDidMount}
        options={{
          minimap: { enabled: false },
          fontSize: 14,
          lineNumbers: 'on',
          folding: true,
          foldingStrategy: 'auto',
          wordWrap: 'on',
          automaticLayout: true,
          scrollBeyondLastLine: false,
          tabSize: 2,
          insertSpaces: true,
          renderWhitespace: 'selection',
          bracketPairColorization: { enabled: true },
          scrollbar: {
            verticalScrollbarSize: 6,
            horizontalScrollbarSize: 6
          }
        }}
      />
    </div>
  )
}
