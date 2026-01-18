import { useMemo } from 'react'

interface MarkdownPreviewProps {
  content: string
}

// Simple markdown to HTML conversion for preview
function markdownToHtml(markdown: string): string {
  let html = markdown

  // Escape HTML
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // Code blocks (must be before other processing)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code class="language-${lang}">${code.trim()}</code></pre>`
  })

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')

  // Headers
  html = html.replace(/^###### (.+)$/gm, '<h6>$1</h6>')
  html = html.replace(/^##### (.+)$/gm, '<h5>$1</h5>')
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>')
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')
  html = html.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>')
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>')
  html = html.replace(/_(.+?)_/g, '<em>$1</em>')

  // Strikethrough
  html = html.replace(/~~(.+?)~~/g, '<s>$1</s>')

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')

  // Images
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />')

  // Blockquotes
  html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')

  // Horizontal rules
  html = html.replace(/^(?:---|\*\*\*|___)$/gm, '<hr />')

  // Unordered lists (simple version)
  html = html.replace(/^[*-] (.+)$/gm, '<li>$1</li>')
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')

  // Ordered lists (simple version)
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>')

  // Paragraphs (wrap non-block content)
  html = html.split('\n\n').map(block => {
    if (
      block.startsWith('<h') ||
      block.startsWith('<ul') ||
      block.startsWith('<ol') ||
      block.startsWith('<pre') ||
      block.startsWith('<blockquote') ||
      block.startsWith('<hr')
    ) {
      return block
    }
    if (block.trim()) {
      return `<p>${block.replace(/\n/g, '<br />')}</p>`
    }
    return ''
  }).join('\n')

  return html
}

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  const html = useMemo(() => markdownToHtml(content), [content])

  return (
    <div className="p-4 prose prose-slate dark:prose-invert max-w-none">
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}
