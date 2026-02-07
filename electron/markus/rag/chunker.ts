/**
 * Markdown-Aware Chunker
 *
 * Splits markdown documents into semantic chunks for embedding.
 * Preserves heading hierarchy and respects natural document boundaries.
 * Designed for RAG (Retrieval-Augmented Generation) systems.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * A chunk of text with metadata.
 */
export interface TextChunk {
  /** Unique chunk identifier */
  id: string
  /** Source file path */
  filePath: string
  /** Chunk content */
  content: string
  /** Estimated token count */
  tokens: number
  /** Starting line number (1-indexed) */
  startLine: number
  /** Ending line number (1-indexed) */
  endLine: number
  /** Heading hierarchy context */
  headingContext: string[]
  /** Document section title (nearest heading) */
  sectionTitle?: string
  /** Chunk sequence number within file */
  chunkIndex: number
}

/**
 * Chunking options.
 */
export interface ChunkOptions {
  /** Maximum tokens per chunk (default: 512) */
  maxChunkSize?: number
  /** Token overlap between chunks (default: 50) */
  overlap?: number
  /** Minimum chunk size in tokens (default: 50) */
  minChunkSize?: number
}

// ============================================================================
// Token Estimation
// ============================================================================

/**
 * Estimate token count for a string.
 * Uses rough approximation of ~4 characters per token.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

// ============================================================================
// Markdown Parsing
// ============================================================================

/**
 * Represents a parsed section of markdown.
 */
interface MarkdownSection {
  /** Heading level (1-6, or 0 for root) */
  level: number
  /** Heading text */
  title: string
  /** Section content (without subsections) */
  content: string
  /** Starting line */
  startLine: number
  /** Ending line */
  endLine: number
  /** Child sections */
  children: MarkdownSection[]
}

/**
 * Parse markdown into a hierarchical section structure.
 */
function parseMarkdownSections(content: string): MarkdownSection {
  const lines = content.split('\n')
  const root: MarkdownSection = {
    level: 0,
    title: '',
    content: '',
    startLine: 1,
    endLine: lines.length,
    children: []
  }

  // Stack to track current section hierarchy
  const stack: MarkdownSection[] = [root]
  let currentContentLines: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNumber = i + 1
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)

    if (headingMatch) {
      // Save accumulated content to current section
      const currentSection = stack[stack.length - 1]
      if (currentContentLines.length > 0) {
        currentSection.content += currentContentLines.join('\n')
        currentContentLines = []
      }

      const level = headingMatch[1].length
      const title = headingMatch[2].trim()

      // Create new section
      const newSection: MarkdownSection = {
        level,
        title,
        content: '',
        startLine: lineNumber,
        endLine: lineNumber,
        children: []
      }

      // Find parent (first section with lower level)
      while (stack.length > 1 && stack[stack.length - 1].level >= level) {
        const popped = stack.pop()!
        popped.endLine = lineNumber - 1
      }

      // Add to parent's children
      stack[stack.length - 1].children.push(newSection)
      stack.push(newSection)

    } else {
      currentContentLines.push(line)
    }
  }

  // Finalize remaining content and sections
  if (currentContentLines.length > 0) {
    const currentSection = stack[stack.length - 1]
    currentSection.content += currentContentLines.join('\n')
  }

  // Set end lines for remaining sections
  while (stack.length > 1) {
    const popped = stack.pop()!
    popped.endLine = lines.length
  }
  root.endLine = lines.length

  return root
}

/**
 * Get heading context for a section.
 */
function getHeadingContext(
  section: MarkdownSection,
  parent: string[] = []
): string[] {
  if (section.level === 0) {
    return parent
  }
  return [...parent, section.title]
}

// ============================================================================
// Chunking
// ============================================================================

/**
 * Split a text block into smaller chunks with overlap.
 */
function splitWithOverlap(
  text: string,
  maxTokens: number,
  overlapTokens: number,
  startLine: number
): Array<{ content: string; startLine: number; endLine: number }> {
  const chunks: Array<{ content: string; startLine: number; endLine: number }> = []
  const lines = text.split('\n')

  if (lines.length === 0 || !text.trim()) {
    return chunks
  }

  let currentChunk: string[] = []
  let currentTokens = 0
  let chunkStartLine = startLine

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineTokens = estimateTokens(line)

    if (currentTokens + lineTokens > maxTokens && currentChunk.length > 0) {
      // Save current chunk
      chunks.push({
        content: currentChunk.join('\n'),
        startLine: chunkStartLine,
        endLine: startLine + i - 1
      })

      // Calculate overlap start
      const overlapLines: string[] = []
      let overlapTokenCount = 0
      for (let j = currentChunk.length - 1; j >= 0 && overlapTokenCount < overlapTokens; j--) {
        overlapLines.unshift(currentChunk[j])
        overlapTokenCount += estimateTokens(currentChunk[j])
      }

      // Start new chunk with overlap
      currentChunk = overlapLines
      currentTokens = overlapTokenCount
      chunkStartLine = startLine + i - overlapLines.length
    }

    currentChunk.push(line)
    currentTokens += lineTokens
  }

  // Add final chunk
  if (currentChunk.length > 0) {
    chunks.push({
      content: currentChunk.join('\n'),
      startLine: chunkStartLine,
      endLine: startLine + lines.length - 1
    })
  }

  return chunks
}

/**
 * Process a markdown section into chunks.
 */
function chunkSection(
  section: MarkdownSection,
  filePath: string,
  options: Required<ChunkOptions>,
  headingContext: string[],
  chunks: TextChunk[]
): void {
  const context = getHeadingContext(section, headingContext)

  // Chunk the section's own content
  if (section.content.trim()) {
    const sectionChunks = splitWithOverlap(
      section.content.trim(),
      options.maxChunkSize,
      options.overlap,
      section.startLine
    )

    for (const chunk of sectionChunks) {
      const tokens = estimateTokens(chunk.content)
      if (tokens >= options.minChunkSize) {
        chunks.push({
          id: `${filePath}:${chunk.startLine}-${chunk.endLine}`,
          filePath,
          content: chunk.content,
          tokens,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          headingContext: context,
          sectionTitle: section.title || undefined,
          chunkIndex: chunks.length
        })
      }
    }
  }

  // Process child sections
  for (const child of section.children) {
    chunkSection(child, filePath, options, context, chunks)
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Chunk a markdown document.
 */
export function chunkMarkdown(
  content: string,
  filePath: string,
  options: ChunkOptions = {}
): TextChunk[] {
  const opts: Required<ChunkOptions> = {
    maxChunkSize: options.maxChunkSize ?? 512,
    overlap: options.overlap ?? 50,
    minChunkSize: options.minChunkSize ?? 50
  }

  const root = parseMarkdownSections(content)
  const chunks: TextChunk[] = []

  chunkSection(root, filePath, opts, [], chunks)

  // Re-number chunks
  for (let i = 0; i < chunks.length; i++) {
    chunks[i].chunkIndex = i
    chunks[i].id = `${filePath}:chunk-${i}`
  }

  return chunks
}

/**
 * Chunk a plain text document (non-markdown).
 */
export function chunkPlainText(
  content: string,
  filePath: string,
  options: ChunkOptions = {}
): TextChunk[] {
  const opts: Required<ChunkOptions> = {
    maxChunkSize: options.maxChunkSize ?? 512,
    overlap: options.overlap ?? 50,
    minChunkSize: options.minChunkSize ?? 50
  }

  const rawChunks = splitWithOverlap(content, opts.maxChunkSize, opts.overlap, 1)
  const chunks: TextChunk[] = []

  for (let i = 0; i < rawChunks.length; i++) {
    const chunk = rawChunks[i]
    const tokens = estimateTokens(chunk.content)

    if (tokens >= opts.minChunkSize) {
      chunks.push({
        id: `${filePath}:chunk-${i}`,
        filePath,
        content: chunk.content,
        tokens,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        headingContext: [],
        chunkIndex: i
      })
    }
  }

  return chunks
}

/**
 * Chunk a document, detecting type from file extension.
 */
export function chunkDocument(
  content: string,
  filePath: string,
  options: ChunkOptions = {}
): TextChunk[] {
  const ext = filePath.toLowerCase().split('.').pop() || ''

  if (['md', 'markdown', 'mdx'].includes(ext)) {
    return chunkMarkdown(content, filePath, options)
  }

  return chunkPlainText(content, filePath, options)
}
