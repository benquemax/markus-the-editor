/**
 * FileViewer Router Component
 *
 * Routes to the appropriate viewer/editor based on file type.
 * This is the main entry point for displaying file content.
 */

import { forwardRef, useImperativeHandle, useRef } from 'react'
import { ProseMirrorEditor, ProseMirrorEditorHandle } from '../../editor/ProseMirrorEditor'
import { ImageViewer } from './ImageViewer'
import { VideoPlayer } from './VideoPlayer'
import { JsonEditor } from './JsonEditor'
import { HtmlEditor } from './HtmlEditor'
import { CodeEditor } from './CodeEditor'
import { Tab } from '../TabBar'
import { FileQuestion } from 'lucide-react'

interface FileViewerProps {
  tab: Tab
  onContentChange: (content: string, wordCount: number, charCount: number) => void
  onSave: () => void
}

export interface FileViewerHandle {
  setContent: (content: string) => void
  getContent: () => string
}

/**
 * Unsupported File Viewer
 * Shown when a file type is not recognized.
 */
function UnsupportedViewer({ filePath }: { filePath: string | null }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-8">
      <FileQuestion className="w-16 h-16 mb-4 opacity-50" />
      <h2 className="text-lg font-medium mb-2">Unsupported File Type</h2>
      <p className="text-sm text-center max-w-md">
        {filePath
          ? `Cannot display file: ${filePath.split('/').pop()}`
          : 'This file type is not supported for viewing or editing.'}
      </p>
    </div>
  )
}

export const FileViewer = forwardRef<FileViewerHandle, FileViewerProps>(
  function FileViewer({ tab, onContentChange, onSave }, ref) {
    const proseMirrorRef = useRef<ProseMirrorEditorHandle>(null)

    // Expose methods for parent components (mainly used by markdown editor)
    useImperativeHandle(ref, () => ({
      setContent: (content: string) => {
        if (proseMirrorRef.current) {
          proseMirrorRef.current.setContent(content)
        }
      },
      getContent: () => {
        if (proseMirrorRef.current) {
          return proseMirrorRef.current.getContent()
        }
        return tab.content
      }
    }), [tab.content])

    // Handle content changes for non-markdown editors
    const handleTextContentChange = (content: string) => {
      // For text editors like JSON/HTML, we pass 0 for word/char counts
      // since these metrics aren't meaningful for code
      onContentChange(content, 0, 0)
    }

    switch (tab.fileType) {
      case 'markdown':
        return (
          <ProseMirrorEditor
            ref={proseMirrorRef}
            initialContent={tab.content}
            filePath={tab.filePath}
            onChange={onContentChange}
            onSave={onSave}
          />
        )

      case 'image':
        if (!tab.binaryData) {
          return <UnsupportedViewer filePath={tab.filePath} />
        }
        return (
          <ImageViewer
            data={tab.binaryData}
            filePath={tab.filePath || ''}
          />
        )

      case 'video':
        if (!tab.binaryData) {
          return <UnsupportedViewer filePath={tab.filePath} />
        }
        return (
          <VideoPlayer
            data={tab.binaryData}
            filePath={tab.filePath || ''}
          />
        )

      case 'json':
        return (
          <JsonEditor
            content={tab.content}
            onChange={handleTextContentChange}
            onSave={onSave}
          />
        )

      case 'html':
        return (
          <HtmlEditor
            content={tab.content}
            onChange={handleTextContentChange}
            onSave={onSave}
          />
        )

      default:
        // For unknown file types, open in code editor mode
        return (
          <CodeEditor
            content={tab.content}
            filePath={tab.filePath}
            onChange={handleTextContentChange}
            onSave={onSave}
          />
        )
    }
  }
)
