/**
 * Document Export Pipelines
 *
 * Converts Markdown content to foreign document formats (DOCX, ODT, HTML).
 * PDF export remains in main.ts since it uses Electron's printToPDF API.
 *
 * Each exporter takes Markdown content, converts to HTML via markdown-it,
 * then transforms to the target format. Returns a Buffer or string ready
 * to write to disk.
 */

import MarkdownIt from 'markdown-it'
import HTMLtoDOCX from 'html-to-docx'
import JSZip from 'jszip'

/**
 * Shared markdown-it instance for converting Markdown → HTML.
 * Used as the first step in all export pipelines.
 */
const md = new MarkdownIt({ html: true, linkify: true, typographer: true })

/**
 * Base HTML template wrapping markdown-it output with styled typography.
 * Used by HTML export directly, and as input for DOCX/ODT conversion.
 */
function wrapInHtmlDocument(bodyHtml: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      max-width: 800px;
      margin: 40px auto;
      padding: 0 20px;
      color: #333;
    }
    h1, h2, h3, h4, h5, h6 { margin-top: 1.5em; margin-bottom: 0.5em; }
    h1 { font-size: 2em; }
    h2 { font-size: 1.5em; }
    h3 { font-size: 1.25em; }
    p { margin: 0.8em 0; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
    pre { background: #f4f4f4; padding: 16px; border-radius: 6px; overflow-x: auto; }
    pre code { background: none; padding: 0; }
    blockquote { border-left: 4px solid #ddd; margin: 1em 0; padding: 0.5em 1em; color: #666; }
    table { border-collapse: collapse; width: 100%; margin: 1em 0; }
    th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
    th { background: #f4f4f4; font-weight: 600; }
    img { max-width: 100%; }
    hr { border: none; border-top: 1px solid #ddd; margin: 2em 0; }
    a { color: #0366d6; }
    ul, ol { padding-left: 2em; }
  </style>
</head>
<body>
${bodyHtml}
</body>
</html>`
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Export Markdown to HTML.
 * Pipeline: markdown-it → wrap in styled HTML document → string
 */
export async function exportHtml(content: string, title: string): Promise<string> {
  const bodyHtml = md.render(content)
  return wrapInHtmlDocument(bodyHtml, title)
}

/**
 * Export Markdown to DOCX.
 * Pipeline: markdown-it → styled HTML → html-to-docx → Buffer
 *
 * html-to-docx expects a full HTML string and returns a Buffer/ArrayBuffer.
 */
export async function exportDocx(content: string, title: string): Promise<Buffer> {
  const bodyHtml = md.render(content)

  // html-to-docx expects the HTML body content and optional header HTML
  const styledHtml = `
    <div style="font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.6;">
      ${bodyHtml}
    </div>
  `

  const docxBuffer = await HTMLtoDOCX(styledHtml, null, {
    title,
    margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
    font: 'Calibri',
    fontSize: 22
  })

  return Buffer.from(docxBuffer as ArrayBuffer)
}

/**
 * Export Markdown to ODT (OpenDocument Text).
 * Pipeline: markdown-it → HTML → build ODF XML → jszip → Buffer
 *
 * ODT files are ZIP archives with a specific structure:
 * - mimetype (first entry, uncompressed)
 * - META-INF/manifest.xml (file registry)
 * - content.xml (the actual document)
 * - styles.xml (style definitions)
 * - meta.xml (document metadata)
 */
export async function exportOdt(content: string, title: string): Promise<Buffer> {
  const bodyHtml = md.render(content)
  const contentXml = htmlToOdfContent(bodyHtml)
  const stylesXml = buildOdfStyles()
  const metaXml = buildOdfMeta(title)
  const manifestXml = buildOdfManifest()

  const zip = new JSZip()

  // mimetype must be the first entry and stored without compression
  // so ODT-aware tools can identify the file type by reading the first bytes
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' })
  zip.file('META-INF/manifest.xml', manifestXml)
  zip.file('content.xml', contentXml)
  zip.file('styles.xml', stylesXml)
  zip.file('meta.xml', metaXml)

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  return buffer
}

/**
 * Converts HTML (from markdown-it) to ODF content.xml.
 * Translates standard HTML elements to their ODF equivalents.
 */
function htmlToOdfContent(html: string): string {
  let body = html

  // Headings: <hN> → <text:h text:outline-level="N" text:style-name="Heading_N">
  body = body.replace(/<h(\d)[^>]*>([\s\S]*?)<\/h\1>/gi,
    (_, level, content) => `<text:h text:style-name="Heading_20_${level}" text:outline-level="${level}">${stripHtmlTags(content)}</text:h>`)

  // Bold + italic
  body = body.replace(/<strong>([\s\S]*?)<\/strong>/gi,
    (_, content) => `<text:span text:style-name="Bold">${content}</text:span>`)
  body = body.replace(/<em>([\s\S]*?)<\/em>/gi,
    (_, content) => `<text:span text:style-name="Italic">${content}</text:span>`)

  // Links
  body = body.replace(/<a\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
    (_, href, content) => `<text:a xlink:type="simple" xlink:href="${href}">${stripHtmlTags(content)}</text:a>`)

  // List items first, then lists
  body = body.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi,
    (_, content) => `<text:list-item><text:p text:style-name="List_20_Contents">${stripHtmlTags(content)}</text:p></text:list-item>`)
  body = body.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi,
    (_, content) => `<text:list text:style-name="List_20_1">${content}</text:list>`)
  body = body.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi,
    (_, content) => `<text:list text:style-name="List_20_1">${content}</text:list>`)

  // Code blocks: <pre><code> → <text:p> with monospace style
  body = body.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi,
    (_, content) => {
      const lines = stripHtmlTags(content).split('\n')
      return lines.map(line =>
        `<text:p text:style-name="Preformatted_20_Text">${escapeXml(line)}</text:p>`
      ).join('')
    })

  // Inline code
  body = body.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi,
    (_, content) => `<text:span text:style-name="Source_20_Text">${stripHtmlTags(content)}</text:span>`)

  // Blockquotes: flatten to styled paragraphs
  body = body.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi,
    (_, content) => {
      // Extract inner paragraphs or use content directly
      const inner = content.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n').trim()
      return `<text:p text:style-name="Quotations">${stripHtmlTags(inner)}</text:p>`
    })

  // Horizontal rules
  body = body.replace(/<hr\s*\/?>/gi,
    '<text:p text:style-name="Horizontal_20_Line"/>')

  // Line breaks
  body = body.replace(/<br\s*\/?>/gi, '<text:line-break/>')

  // Paragraphs (must be last since other elements may contain <p>)
  body = body.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi,
    (_, content) => `<text:p text:style-name="Text_20_body">${content}</text:p>`)

  // Strip any remaining HTML tags
  body = body.replace(/<\/?(?:div|span|img|table|thead|tbody|tr|th|td|dl|dt|dd|figure|figcaption|section|article|nav|header|footer|main|aside)[^>]*>/gi, '')

  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
  xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  office:version="1.3">
  <office:body>
    <office:text>
${body}
    </office:text>
  </office:body>
</office:document-content>`
}

function buildOdfStyles(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
  xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  office:version="1.3">
  <office:styles>
    <style:style style:name="Text_20_body" style:display-name="Text body" style:family="paragraph" style:parent-style-name="Default">
      <style:paragraph-properties fo:margin-top="0.2cm" fo:margin-bottom="0.2cm"/>
      <style:text-properties fo:font-size="11pt" style:font-name="Liberation Sans"/>
    </style:style>
    <style:style style:name="Heading_20_1" style:display-name="Heading 1" style:family="paragraph" style:parent-style-name="Default" style:next-style-name="Text_20_body" style:default-outline-level="1">
      <style:paragraph-properties fo:margin-top="0.8cm" fo:margin-bottom="0.4cm"/>
      <style:text-properties fo:font-size="20pt" fo:font-weight="bold"/>
    </style:style>
    <style:style style:name="Heading_20_2" style:display-name="Heading 2" style:family="paragraph" style:parent-style-name="Default" style:next-style-name="Text_20_body" style:default-outline-level="2">
      <style:paragraph-properties fo:margin-top="0.6cm" fo:margin-bottom="0.3cm"/>
      <style:text-properties fo:font-size="16pt" fo:font-weight="bold"/>
    </style:style>
    <style:style style:name="Heading_20_3" style:display-name="Heading 3" style:family="paragraph" style:parent-style-name="Default" style:next-style-name="Text_20_body" style:default-outline-level="3">
      <style:paragraph-properties fo:margin-top="0.5cm" fo:margin-bottom="0.2cm"/>
      <style:text-properties fo:font-size="14pt" fo:font-weight="bold"/>
    </style:style>
    <style:style style:name="Bold" style:family="text">
      <style:text-properties fo:font-weight="bold"/>
    </style:style>
    <style:style style:name="Italic" style:family="text">
      <style:text-properties fo:font-style="italic"/>
    </style:style>
    <style:style style:name="Source_20_Text" style:display-name="Source Text" style:family="text">
      <style:text-properties style:font-name="Liberation Mono" fo:font-size="10pt"/>
    </style:style>
    <style:style style:name="Preformatted_20_Text" style:display-name="Preformatted Text" style:family="paragraph">
      <style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0cm"/>
      <style:text-properties style:font-name="Liberation Mono" fo:font-size="10pt"/>
    </style:style>
    <style:style style:name="Quotations" style:family="paragraph" style:parent-style-name="Default">
      <style:paragraph-properties fo:margin-left="1cm" fo:margin-top="0.2cm" fo:margin-bottom="0.2cm"/>
      <style:text-properties fo:font-style="italic" fo:color="#666666"/>
    </style:style>
    <style:style style:name="List_20_Contents" style:display-name="List Contents" style:family="paragraph" style:parent-style-name="Default">
      <style:paragraph-properties fo:margin-left="0cm"/>
    </style:style>
    <text:list-style style:name="List_20_1" style:display-name="List 1">
      <text:list-level-style-bullet text:level="1" text:bullet-char="&#x2022;">
        <style:list-level-properties text:list-level-position-and-space-mode="label-alignment">
          <style:list-level-label-alignment text:label-followed-by="listtab" fo:margin-left="1.27cm" fo:text-indent="-0.635cm"/>
        </style:list-level-properties>
      </text:list-level-style-bullet>
    </text:list-style>
  </office:styles>
</office:document-styles>`
}

function buildOdfMeta(title: string): string {
  const now = new Date().toISOString()
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"
  office:version="1.3">
  <office:meta>
    <dc:title>${escapeXml(title)}</dc:title>
    <meta:creation-date>${now}</meta:creation-date>
    <meta:generator>Markus Editor</meta:generator>
  </office:meta>
</office:document-meta>`
}

function buildOdfManifest(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
  <manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="application/vnd.oasis.opendocument.text"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`
}

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>/g, '')
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
