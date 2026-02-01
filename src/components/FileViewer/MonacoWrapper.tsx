/**
 * Monaco Editor Wrapper Component
 *
 * Shared Monaco editor component used by JsonEditor and HtmlEditor.
 * Provides syntax highlighting, code folding, and theme integration.
 */

import { useEffect, useRef, useCallback } from 'react'
import Editor, { OnMount, BeforeMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'

interface MonacoWrapperProps {
  value: string
  language: 'json' | 'html'
  onChange: (value: string) => void
  onSave?: () => void
  readOnly?: boolean
}

export function MonacoWrapper({
  value,
  language,
  onChange,
  onSave,
  readOnly = false
}: MonacoWrapperProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)

  // Detect if we're in dark mode
  const isDarkMode = document.documentElement.classList.contains('dark')

  const handleEditorWillMount: BeforeMount = useCallback((monaco) => {
    // Configure JSON language features
    if (language === 'json') {
      monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
        validate: true,
        allowComments: false,
        schemas: []
      })
    }
  }, [language])

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

  // Update theme when dark mode changes
  useEffect(() => {
    if (editorRef.current) {
      // Theme is handled by the Editor component automatically
    }
  }, [isDarkMode])

  return (
    <Editor
      height="100%"
      language={language}
      value={value}
      theme={isDarkMode ? 'vs-dark' : 'light'}
      onChange={handleChange}
      beforeMount={handleEditorWillMount}
      onMount={handleEditorDidMount}
      options={{
        readOnly,
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
        formatOnPaste: true,
        formatOnType: true,
        renderWhitespace: 'selection',
        bracketPairColorization: { enabled: true }
      }}
    />
  )
}
