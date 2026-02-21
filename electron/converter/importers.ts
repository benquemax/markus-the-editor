/**
 * Document Import Pipelines
 *
 * Converts foreign document formats (DOCX, HTML, PDF, ODT) into Markdown.
 * Each importer reads a file buffer/string and returns a Markdown string.
 *
 * Shared turndown instance is configured once with GFM plugin for consistent
 * HTML-to-Markdown conversion across all pipelines that produce intermediate HTML.
 */

import fs from 'fs/promises'
import mammoth from 'mammoth'
// word-extractor handles legacy .doc (OLE binary) files that mammoth can't parse.
// No types available — it's a plain JS library with a simple extract() → Document API.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import WordExtractor from 'word-extractor'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
// pdfjs-dist is loaded lazily via dynamic import() inside importPdf().
// The standard build uses browser APIs (DOMMatrix) that don't exist in
// Node/Electron main process, so we use the legacy build. Since the
// legacy build is ESM-only (.mjs) and main.js is CJS, a top-level
// import/require would fail — dynamic import() handles this correctly.
import JSZip from 'jszip'
import path from 'path'

/**
 * Shared turndown instance with GFM support (tables, task lists, strikethrough).
 * Reused across all HTML-to-Markdown conversions for consistency.
 */
// Named "td" to avoid colliding with the "turndown" package name — vite's
// CJS bundler would shadow the instance with the require() binding otherwise
const td: TurndownService = (() => {
  const svc = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-'
  })
  svc.use(gfm)
  return svc
})()

/**
 * Import a DOCX file to Markdown.
 * Pipeline: fs.readFile → mammoth.convertToHtml → turndown → MD
 *
 * mammoth only supports .docx (Office Open XML / ZIP-based), not legacy .doc.
 */
export async function importDocx(sourcePath: string): Promise<string> {
  const buffer = await fs.readFile(sourcePath)
  const result = await mammoth.convertToHtml({ buffer })

  if (result.messages.length > 0) {
    console.warn('[Converter] mammoth warnings:', result.messages)
  }

  return td.turndown(result.value)
}

/**
 * Import a legacy .doc (Word 97-2003) file to Markdown.
 * Pipeline: word-extractor → plain text → MD
 *
 * Legacy .doc is a binary OLE format that mammoth can't read.
 * word-extractor parses the OLE structure directly in pure JS.
 * The result is plain text (no formatting) — similar to PDF import.
 */
export async function importDoc(sourcePath: string): Promise<string> {
  const extractor = new WordExtractor()
  const doc = await extractor.extract(sourcePath)
  return doc.getBody()
}

/**
 * Import an HTML file to Markdown.
 * Pipeline: fs.readFile → turndown → MD
 */
export async function importHtml(sourcePath: string): Promise<string> {
  const html = await fs.readFile(sourcePath, 'utf-8')
  return td.turndown(html)
}

/**
 * Import a PDF file to Markdown.
 * Pipeline: fs.readFile → pdfjs-dist → extract text per page → MD
 *
 * PDFs are inherently lossy for conversion since they lack semantic structure.
 * The result is a best-effort plain text extraction with page separators.
 */
export async function importPdf(sourcePath: string): Promise<string> {
  const data = new Uint8Array(await fs.readFile(sourcePath))

  // Dynamic import because pdfjs-dist legacy is ESM-only and our bundle is CJS
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const { getDocument } = pdfjs as unknown as typeof import('pdfjs-dist')
  const doc = await getDocument({ data, useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true }).promise

  const pages: string[] = []

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const textContent = await page.getTextContent()

    // Build text from items, detecting line breaks via Y-position changes
    let lastY: number | null = null
    let pageText = ''

    for (const item of textContent.items) {
      if (!('str' in item)) continue
      const textItem = item as { str: string; transform: number[] }
      const y = textItem.transform[5]

      if (lastY !== null && Math.abs(y - lastY) > 2) {
        pageText += '\n'
      } else if (lastY !== null) {
        pageText += ' '
      }

      pageText += textItem.str
      lastY = y
    }

    if (pageText.trim()) {
      pages.push(pageText.trim())
    }
  }

  return pages.join('\n\n---\n\n')
}

/**
 * Import an ODT (OpenDocument Text) file to Markdown.
 * Pipeline: fs.readFile → JSZip → parse content.xml → build HTML → turndown → MD
 *
 * ODF XML uses its own element namespace (text:h, text:p, text:list, etc.).
 * We translate these into standard HTML elements, then let turndown handle
 * the HTML-to-Markdown conversion for consistency with other importers.
 */
export async function importOdt(sourcePath: string): Promise<string> {
  const buffer = await fs.readFile(sourcePath)
  const zip = await JSZip.loadAsync(buffer)

  const contentXml = await zip.file('content.xml')?.async('string')
  if (!contentXml) {
    throw new Error('Invalid ODT: missing content.xml')
  }

  const html = odfXmlToHtml(contentXml)
  return td.turndown(html)
}

/**
 * Converts ODF XML content to HTML by walking the XML string with a
 * lightweight regex-based parser. Full XML parsing (DOMParser) isn't
 * available in Node without extra deps, and the ODF subset we care
 * about is simple enough for regex extraction.
 *
 * Supported ODF elements:
 * - <text:h outline-level="N"> → <hN>
 * - <text:p> → <p>
 * - <text:list> → <ul>  (ODF doesn't distinguish ordered/unordered reliably)
 * - <text:list-item> → <li>
 * - <text:span text:style-name="..."> → <strong>/<em> based on style name heuristics
 * - <text:a xlink:href="..."> → <a href="...">
 * - <text:line-break/> → <br>
 * - <text:tab/> → tab character
 */
function odfXmlToHtml(xml: string): string {
  let html = xml

  // Extract just the body content between <office:text> tags
  const bodyMatch = html.match(/<office:text[^>]*>([\s\S]*?)<\/office:text>/)
  if (bodyMatch) {
    html = bodyMatch[1]
  }

  // Headings: <text:h text:outline-level="N"> → <hN>
  html = html.replace(/<text:h[^>]*text:outline-level="(\d)"[^>]*>([\s\S]*?)<\/text:h>/g,
    (_, level, content) => `<h${level}>${content}</h${level}>`)
  // Handle attribute order variant
  html = html.replace(/<text:h[^>]*>([\s\S]*?)<\/text:h>/g,
    (_, content) => `<p>${content}</p>`)

  // Links: <text:a xlink:href="URL"> → <a href="URL">
  html = html.replace(/<text:a[^>]*xlink:href="([^"]*)"[^>]*>([\s\S]*?)<\/text:a>/g,
    (_, href, content) => `<a href="${href}">${content}</a>`)

  // Bold/italic spans: heuristic based on style names containing Bold/Italic
  html = html.replace(/<text:span[^>]*text:style-name="([^"]*)"[^>]*>([\s\S]*?)<\/text:span>/g,
    (_, styleName: string, content: string) => {
      const lower = styleName.toLowerCase()
      if (lower.includes('bold') && lower.includes('italic')) return `<strong><em>${content}</em></strong>`
      if (lower.includes('bold')) return `<strong>${content}</strong>`
      if (lower.includes('italic')) return `<em>${content}</em>`
      return content
    })
  // Plain spans without recognized styles
  html = html.replace(/<text:span[^>]*>([\s\S]*?)<\/text:span>/g, '$1')

  // Lists
  html = html.replace(/<text:list-item>/g, '<li>')
  html = html.replace(/<\/text:list-item>/g, '</li>')
  html = html.replace(/<text:list[^>]*>/g, '<ul>')
  html = html.replace(/<\/text:list>/g, '</ul>')

  // Paragraphs: <text:p> → <p>
  html = html.replace(/<text:p[^>]*>([\s\S]*?)<\/text:p>/g, '<p>$1</p>')

  // Line breaks and tabs
  html = html.replace(/<text:line-break\s*\/>/g, '<br>')
  html = html.replace(/<text:tab\s*\/>/g, '\t')

  // Strip remaining ODF/XML tags we don't handle
  html = html.replace(/<[^>]*?(?:office|style|text|table|draw|fo|svg|xlink):[^>]*>/g, '')

  return html
}

/**
 * Detects the import format from a file extension and calls the appropriate importer.
 * Returns the Markdown string, or throws if the format is unsupported.
 */
export async function importFile(sourcePath: string): Promise<string> {
  const ext = path.extname(sourcePath).toLowerCase()

  switch (ext) {
    case '.docx':
      return importDocx(sourcePath)
    case '.doc':
      return importDoc(sourcePath)
    case '.html':
    case '.htm':
      return importHtml(sourcePath)
    case '.pdf':
      return importPdf(sourcePath)
    case '.odt':
      return importOdt(sourcePath)
    default:
      throw new Error(`Unsupported import format: ${ext}`)
  }
}

/** File extensions that can be imported (converted to Markdown). */
export const IMPORTABLE_EXTENSIONS = ['.docx', '.doc', '.odt', '.pdf', '.html', '.htm']
