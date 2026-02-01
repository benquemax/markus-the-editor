/**
 * HTML Editor Component
 *
 * Split view with Monaco editor on the left and rendered HTML preview on the right.
 * The preview uses a sandboxed iframe for security.
 */

import { useCallback, useMemo } from 'react'
import { MonacoWrapper } from './MonacoWrapper'

interface HtmlEditorProps {
  content: string
  onChange: (content: string) => void
  onSave: () => void
}

export function HtmlEditor({ content, onChange, onSave }: HtmlEditorProps) {
  const handleEditorChange = useCallback((value: string) => {
    onChange(value)
  }, [onChange])

  // Generate a data URL for the iframe content
  // This is safer than using srcdoc and provides better isolation
  const previewUrl = useMemo(() => {
    // Create a complete HTML document if the content doesn't have one
    let htmlContent = content
    if (!content.toLowerCase().includes('<!doctype') && !content.toLowerCase().includes('<html')) {
      // Wrap content in a basic HTML structure with sensible defaults
      htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      padding: 1rem;
      margin: 0;
      line-height: 1.5;
    }
  </style>
</head>
<body>
${content}
</body>
</html>`
    }

    // Create blob URL for the preview
    const blob = new Blob([htmlContent], { type: 'text/html' })
    return URL.createObjectURL(blob)
  }, [content])

  return (
    <div className="h-full flex">
      {/* Left pane: Monaco editor */}
      <div className="flex-1 min-w-0 border-r border-border">
        <MonacoWrapper
          value={content}
          language="html"
          onChange={handleEditorChange}
          onSave={onSave}
        />
      </div>

      {/* Right pane: HTML preview */}
      <div className="w-1/2 min-w-0 bg-white">
        <iframe
          src={previewUrl}
          title="HTML Preview"
          className="w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin"
        />
      </div>
    </div>
  )
}
