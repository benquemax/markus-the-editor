/**
 * URL Importer Utilities
 *
 * Provides slug extraction from URLs, title slugification for filenames,
 * and YAML frontmatter generation with source metadata. These utilities
 * support the URL import pipeline where web pages are fetched and converted
 * to markdown documents with provenance tracking.
 *
 * Used by the converter IPC handler for all URL import entry points
 * (drag-and-drop, menu, keyboard shortcut). Sits alongside importers.ts
 * and exporters.ts in the converter module.
 */

/**
 * Extracts a URL-safe slug from the last path segment of a URL.
 * Strips file extensions, query params, and hash fragments.
 * Returns null for index/root pages that have no meaningful path.
 */
export function extractSlug(url: string): string | null {
  try {
    const parsed = new URL(url)
    // pathname is already stripped of query/hash by the URL constructor
    const segments = parsed.pathname.replace(/\/+$/, '').split('/').filter(Boolean)
    if (segments.length === 0) return null

    let slug = segments[segments.length - 1]
    // Strip common web file extensions (.html, .php, etc.)
    slug = slug.replace(/\.[^.]+$/, '')
    return slug || null
  } catch {
    return null
  }
}

/**
 * Slugifies a title for use as a filename: lowercase, dashes for spaces,
 * strip non-alphanumeric characters. Follows the same conventions as
 * common static site generators (Jekyll, Hugo, etc.).
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
 * Generates a YAML frontmatter block from import metadata.
 * Only includes fields that have values. Escapes YAML special characters
 * in text values (title, author) but leaves URLs unquoted since YAML
 * handles them natively.
 *
 * Returns the frontmatter block with trailing double newline, ready
 * to be prepended to a markdown document body.
 *
 * NOTE: A more comprehensive frontmatter module exists at src/lib/frontmatter.ts
 * which handles round-trip parsing and serialization via js-yaml. This simpler
 * generator exists separately because URL imports only need one-way generation
 * of a known set of fields — pulling in js-yaml and the full extract/inject
 * machinery would be unnecessary overhead for this use case.
 */
export function generateFrontmatter(data: FrontmatterData): string {
  const lines: string[] = ['---']

  // YAML requires quoting strings that contain special characters like colons,
  // brackets, etc. URLs are safe unquoted in YAML, so we only escape text fields.
  // Also catches internal quotes (e.g., O'Brien) and bare boolean/null keywords
  // that YAML parsers would interpret as non-string types.
  const YAML_BARE_KEYWORDS = /^(true|false|yes|no|on|off|null)$/i
  const escapeYaml = (val: string) => {
    if (
      /[:#{}[\]&*?|>!@`'"]/.test(val) ||
      YAML_BARE_KEYWORDS.test(val)
    ) {
      return `"${val.replace(/"/g, '\\"')}"`
    }
    return val
  }

  // Source is always a URL — YAML handles these fine without quoting
  lines.push(`source: ${data.source}`)
  if (data.title) lines.push(`title: ${escapeYaml(data.title)}`)
  if (data.author) lines.push(`author: ${escapeYaml(data.author)}`)
  // ISO date strings are YAML-safe, no escaping needed
  lines.push(`date_imported: ${data.dateImported}`)

  lines.push('---')
  return lines.join('\n') + '\n\n'
}

export interface ImportUrlResult {
  markdown: string
  title: string
  slug: string
}

/**
 * Fetches a web page and converts it to clean markdown using Defuddle
 * for article extraction. Returns markdown with frontmatter, page title,
 * and a filename slug.
 *
 * Defuddle is Mozilla's Readability successor — it strips navigation,
 * ads, and boilerplate, keeping only the article content. The `markdown: true`
 * option makes it return Markdown directly instead of HTML.
 */
export async function importUrl(url: string): Promise<ImportUrlResult> {
  // Defuddle is ESM-only, use dynamic import (same pattern as pdfjs-dist in importers.ts)
  const { Defuddle } = await import('defuddle/node')

  const response = await fetch(url, {
    headers: {
      // Identify ourselves honestly — some sites block unknown user agents
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

  const result = await Defuddle(html, url, { markdown: true })

  const title = result.title || 'Untitled'
  const slug = extractSlug(url) || slugifyTitle(title)
  // ISO date without time — matches the YAML date scalar convention
  const dateImported = new Date().toISOString().split('T')[0]

  const frontmatter = generateFrontmatter({
    source: url,
    title: result.title || undefined,
    author: result.author || undefined,
    dateImported
  })

  // When markdown: true is passed, Defuddle puts the converted markdown
  // into result.content (overwriting the original HTML)
  const markdown = frontmatter + (result.content || '')

  return { markdown, title, slug }
}
