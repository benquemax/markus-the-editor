/**
 * Comment System Utilities
 *
 * Handles parsing and serialization of inline comments in markdown.
 * Comments use HTML comment syntax:
 *   <!-- COMMENT: [{ "alice": "First comment" }, { "bob": "Reply" }] -->highlighted text<!-- /COMMENT -->
 *
 * The comment marker wraps the highlighted text. Thread data (author + text entries)
 * lives inside the opening marker as a JSON array of { username: text } objects.
 */

// ============================================================================
// Types
// ============================================================================

export interface CommentEntry {
  author: string
  text: string
}

export interface CommentThread {
  id: string
  entries: CommentEntry[]
}

/** Result of extracting comments from raw markdown */
export interface ParsedComment {
  thread: CommentThread
  /** Character offset in the cleaned (marker-free) text where the highlight starts */
  startOffset: number
  /** Character offset in the cleaned text where the highlight ends */
  endOffset: number
}

/** Data needed to inject comment markers back into serialized markdown */
export interface CommentInjection {
  thread: CommentThread
  /** Character offset in the plain serialized markdown */
  startOffset: number
  endOffset: number
}

// ============================================================================
// Comment ID Generation
// ============================================================================

let commentCounter = 0

/** Generates a short unique ID for a comment thread */
export function generateCommentId(): string {
  commentCounter++
  return `c${Date.now().toString(36)}${commentCounter.toString(36)}`
}

// ============================================================================
// Parsing: Markdown → CommentThread[]
// ============================================================================

// Matches: <!-- COMMENT: [...] -->...<!-- /COMMENT -->
// Group 1: the JSON array inside the opening marker
// Group 2: the highlighted text between markers
const COMMENT_REGEX = /<!-- COMMENT: (\[.*?\]) -->([\s\S]*?)<!-- \/COMMENT -->/g

/**
 * Extracts comment regions from raw markdown.
 *
 * Returns cleaned markdown (all comment markers stripped, highlighted text kept)
 * plus a list of parsed comments with their text offsets in the cleaned string.
 */
export function extractComments(markdown: string): { cleaned: string; comments: ParsedComment[] } {
  const comments: ParsedComment[] = []

  // We need to track how stripping markers shifts text positions.
  // Process from left to right, building the cleaned string and recording offsets.
  let cleaned = ''
  let lastIndex = 0
  let match: RegExpExecArray | null

  // Reset regex state
  COMMENT_REGEX.lastIndex = 0

  while ((match = COMMENT_REGEX.exec(markdown)) !== null) {
    const [fullMatch, jsonStr, highlightedText] = match
    const matchStart = match.index

    // Append text before this match
    cleaned += markdown.slice(lastIndex, matchStart)

    // Parse the thread entries from JSON
    const entries = parseCommentEntries(jsonStr)
    const thread: CommentThread = {
      id: generateCommentId(),
      entries
    }

    // Record the start offset in cleaned text
    const startOffset = cleaned.length

    // Append the highlighted text (without markers)
    cleaned += highlightedText

    const endOffset = cleaned.length

    comments.push({ thread, startOffset, endOffset })

    lastIndex = matchStart + fullMatch.length
  }

  // Append remaining text after last match
  cleaned += markdown.slice(lastIndex)

  return { cleaned, comments }
}

/**
 * Parses the JSON array from a comment marker into CommentEntry[].
 * Each entry in the array is { username: text }.
 */
function parseCommentEntries(jsonStr: string): CommentEntry[] {
  try {
    const arr = JSON.parse(jsonStr)
    if (!Array.isArray(arr)) return []

    return arr.map((obj: Record<string, string>) => {
      // Each object has a single key (username) with value (text)
      const keys = Object.keys(obj)
      if (keys.length === 0) return null
      return { author: keys[0], text: obj[keys[0]] }
    }).filter((e): e is CommentEntry => e !== null)
  } catch {
    return []
  }
}

// ============================================================================
// Serialization: CommentThread[] → Markdown with markers
// ============================================================================

/**
 * Serializes comment entries back to the JSON format used in markers.
 */
export function serializeCommentEntries(entries: CommentEntry[]): string {
  const arr = entries.map(e => ({ [e.author]: e.text }))
  return JSON.stringify(arr)
}

/**
 * Injects comment markers into plain serialized markdown.
 *
 * Takes the marker-free markdown and a list of comment injections (each with
 * text offsets), and produces markdown with `<!-- COMMENT: [...] -->` markers.
 *
 * Injections must be sorted by startOffset ascending.
 */
export function injectComments(markdown: string, injections: CommentInjection[]): string {
  if (injections.length === 0) return markdown

  // Sort by startOffset to process left-to-right
  const sorted = [...injections].sort((a, b) => a.startOffset - b.startOffset)

  let result = ''
  let lastIndex = 0

  for (const injection of sorted) {
    const { thread, startOffset, endOffset } = injection

    // Append text before this injection
    result += markdown.slice(lastIndex, startOffset)

    // Build opening marker
    const json = serializeCommentEntries(thread.entries)
    result += `<!-- COMMENT: ${json} -->`

    // Append the highlighted text
    result += markdown.slice(startOffset, endOffset)

    // Closing marker
    result += '<!-- /COMMENT -->'

    lastIndex = endOffset
  }

  // Append remaining text
  result += markdown.slice(lastIndex)

  return result
}
