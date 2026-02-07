/**
 * Fuzzy Matching for SEARCH/REPLACE Edits
 *
 * Implements multiple matching strategies for finding text in files,
 * designed to handle small model output variations while maintaining
 * accuracy. Strategies are tried in order of strictness.
 *
 * Inspired by Aider's edit format and Cline's diff improvements.
 */

import { distance as levenshteinDistance } from 'fastest-levenshtein'

// ============================================================================
// Types
// ============================================================================

/**
 * Result of a match operation.
 */
export interface MatchResult {
  /** Whether a match was found */
  found: boolean
  /** Matching strategy used */
  strategy: 'exact' | 'whitespace' | 'fuzzy' | 'anchor' | 'none'
  /** Start index in the content */
  startIndex?: number
  /** End index in the content */
  endIndex?: number
  /** Line number where match starts (1-indexed) */
  lineNumber?: number
  /** The actual matched text */
  matchedText?: string
  /** Similarity score (0-1) for fuzzy matches */
  similarity?: number
  /** Confidence level */
  confidence: 'high' | 'medium' | 'low' | 'none'
}

/**
 * Options for matching.
 */
export interface MatchOptions {
  /** Minimum similarity threshold for fuzzy matching (default: 0.85) */
  fuzzyThreshold?: number
  /** Number of context lines for anchor matching (default: 3) */
  anchorContextLines?: number
  /** Whether to allow multiple matches (default: false) */
  allowMultiple?: boolean
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Normalize whitespace for comparison.
 * Trims lines and normalizes internal whitespace.
 */
function normalizeWhitespace(text: string): string {
  return text
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Calculate line number from character index.
 */
function getLineNumber(content: string, index: number): number {
  return content.slice(0, index).split('\n').length
}

/**
 * Calculate Levenshtein similarity (0-1).
 */
function calculateSimilarity(str1: string, str2: string): number {
  const maxLen = Math.max(str1.length, str2.length)
  if (maxLen === 0) return 1
  const dist = levenshteinDistance(str1, str2)
  return 1 - dist / maxLen
}


// ============================================================================
// Matching Strategies
// ============================================================================

/**
 * Strategy 1: Exact match.
 * Direct string comparison with no modifications.
 */
function exactMatch(content: string, search: string): MatchResult {
  const index = content.indexOf(search)

  if (index === -1) {
    return { found: false, strategy: 'exact', confidence: 'none' }
  }

  // Check for multiple matches
  const secondMatch = content.indexOf(search, index + 1)
  if (secondMatch !== -1) {
    return {
      found: true,
      strategy: 'exact',
      startIndex: index,
      endIndex: index + search.length,
      lineNumber: getLineNumber(content, index),
      matchedText: search,
      similarity: 1,
      confidence: 'low'  // Multiple matches reduces confidence
    }
  }

  return {
    found: true,
    strategy: 'exact',
    startIndex: index,
    endIndex: index + search.length,
    lineNumber: getLineNumber(content, index),
    matchedText: search,
    similarity: 1,
    confidence: 'high'
  }
}

/**
 * Strategy 2: Whitespace-normalized match.
 * Ignores differences in indentation and trailing spaces.
 */
function whitespaceNormalizedMatch(content: string, search: string): MatchResult {
  const normalizedSearch = normalizeWhitespace(search)
  const normalizedContent = normalizeWhitespace(content)

  const normalizedIndex = normalizedContent.indexOf(normalizedSearch)
  if (normalizedIndex === -1) {
    return { found: false, strategy: 'whitespace', confidence: 'none' }
  }

  // Find the actual position in original content
  // We need to map back from normalized to original
  const lines = content.split('\n')
  const searchLines = search.split('\n').map(l => l.trim())

  for (let i = 0; i < lines.length; i++) {
    let matchStart = -1
    let matched = true

    for (let j = 0; j < searchLines.length && i + j < lines.length; j++) {
      if (lines[i + j].trim() !== searchLines[j]) {
        matched = false
        break
      }
      if (j === 0) {
        matchStart = lines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0)
      }
    }

    if (matched && matchStart >= 0) {
      const matchEnd = lines.slice(0, i + searchLines.length).join('\n').length

      // Check for multiple matches
      let multipleMatches = false
      for (let k = i + 1; k < lines.length; k++) {
        let secondMatch = true
        for (let j = 0; j < searchLines.length && k + j < lines.length; j++) {
          if (lines[k + j].trim() !== searchLines[j]) {
            secondMatch = false
            break
          }
        }
        if (secondMatch) {
          multipleMatches = true
          break
        }
      }

      return {
        found: true,
        strategy: 'whitespace',
        startIndex: matchStart,
        endIndex: matchEnd,
        lineNumber: i + 1,
        matchedText: lines.slice(i, i + searchLines.length).join('\n'),
        similarity: 0.95,
        confidence: multipleMatches ? 'low' : 'high'
      }
    }
  }

  return { found: false, strategy: 'whitespace', confidence: 'none' }
}

/**
 * Strategy 3: Fuzzy line-by-line match.
 * Uses Levenshtein distance to find approximate matches.
 */
function fuzzyLineMatch(
  content: string,
  search: string,
  threshold: number = 0.85
): MatchResult {
  const contentLines = content.split('\n')
  const searchLines = search.split('\n')

  if (searchLines.length === 0) {
    return { found: false, strategy: 'fuzzy', confidence: 'none' }
  }

  let bestMatch: {
    startLine: number
    endLine: number
    similarity: number
    matchedLines: string[]
  } | null = null

  // Slide search window over content
  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    let totalSimilarity = 0
    const matchedLines: string[] = []

    for (let j = 0; j < searchLines.length; j++) {
      const contentLine = contentLines[i + j]
      const searchLine = searchLines[j]
      const similarity = calculateSimilarity(
        contentLine.trim(),
        searchLine.trim()
      )
      totalSimilarity += similarity
      matchedLines.push(contentLine)
    }

    const avgSimilarity = totalSimilarity / searchLines.length

    if (avgSimilarity >= threshold) {
      if (!bestMatch || avgSimilarity > bestMatch.similarity) {
        bestMatch = {
          startLine: i,
          endLine: i + searchLines.length - 1,
          similarity: avgSimilarity,
          matchedLines
        }
      }
    }
  }

  if (!bestMatch) {
    return { found: false, strategy: 'fuzzy', confidence: 'none' }
  }

  const startIndex = contentLines.slice(0, bestMatch.startLine).join('\n').length +
    (bestMatch.startLine > 0 ? 1 : 0)
  const endIndex = startIndex + bestMatch.matchedLines.join('\n').length

  return {
    found: true,
    strategy: 'fuzzy',
    startIndex,
    endIndex,
    lineNumber: bestMatch.startLine + 1,
    matchedText: bestMatch.matchedLines.join('\n'),
    similarity: bestMatch.similarity,
    confidence: bestMatch.similarity >= 0.95 ? 'high' : 'medium'
  }
}

/**
 * Strategy 4: Anchor-based match.
 * Uses context before/after the search text to locate the region.
 */
function anchorMatch(
  content: string,
  search: string
): MatchResult {
  const searchLines = search.split('\n')

  if (searchLines.length < 2) {
    return { found: false, strategy: 'anchor', confidence: 'none' }
  }

  // Use first and last lines as anchors
  const firstLine = searchLines[0].trim()
  const lastLine = searchLines[searchLines.length - 1].trim()

  if (!firstLine || !lastLine) {
    return { found: false, strategy: 'anchor', confidence: 'none' }
  }

  const contentLines = content.split('\n')

  // Find potential anchor points
  const startCandidates: number[] = []
  const endCandidates: number[] = []

  for (let i = 0; i < contentLines.length; i++) {
    const trimmedLine = contentLines[i].trim()
    const startSim = calculateSimilarity(trimmedLine, firstLine)
    const endSim = calculateSimilarity(trimmedLine, lastLine)

    if (startSim >= 0.8) {
      startCandidates.push(i)
    }
    if (endSim >= 0.8) {
      endCandidates.push(i)
    }
  }

  // Find best matching region
  let bestMatch: {
    start: number
    end: number
    similarity: number
  } | null = null

  for (const start of startCandidates) {
    for (const end of endCandidates) {
      if (end <= start) continue

      // Check if the line count approximately matches
      const actualLineCount = end - start + 1
      const expectedLineCount = searchLines.length
      const lineCountDiff = Math.abs(actualLineCount - expectedLineCount)

      if (lineCountDiff > Math.max(2, expectedLineCount * 0.2)) {
        continue  // Too different in size
      }

      // Calculate overall similarity
      let totalSim = 0
      const matchLen = Math.min(actualLineCount, expectedLineCount)

      for (let i = 0; i < matchLen; i++) {
        const searchIdx = Math.floor(i * expectedLineCount / matchLen)
        const contentIdx = start + i
        totalSim += calculateSimilarity(
          contentLines[contentIdx].trim(),
          searchLines[searchIdx].trim()
        )
      }

      const avgSim = totalSim / matchLen

      if (!bestMatch || avgSim > bestMatch.similarity) {
        bestMatch = { start, end, similarity: avgSim }
      }
    }
  }

  if (!bestMatch || bestMatch.similarity < 0.7) {
    return { found: false, strategy: 'anchor', confidence: 'none' }
  }

  const matchedLines = contentLines.slice(bestMatch.start, bestMatch.end + 1)
  const startIndex = contentLines.slice(0, bestMatch.start).join('\n').length +
    (bestMatch.start > 0 ? 1 : 0)

  return {
    found: true,
    strategy: 'anchor',
    startIndex,
    endIndex: startIndex + matchedLines.join('\n').length,
    lineNumber: bestMatch.start + 1,
    matchedText: matchedLines.join('\n'),
    similarity: bestMatch.similarity,
    confidence: bestMatch.similarity >= 0.85 ? 'medium' : 'low'
  }
}

// ============================================================================
// Main Matching Function
// ============================================================================

/**
 * Find a match for the search text in the content.
 * Tries strategies in order: exact -> whitespace -> fuzzy -> anchor.
 */
export function findMatch(
  content: string,
  search: string,
  options: MatchOptions = {}
): MatchResult {
  const {
    fuzzyThreshold = 0.85
  } = options

  // Empty search is invalid
  if (!search.trim()) {
    return { found: false, strategy: 'none', confidence: 'none' }
  }

  // Strategy 1: Exact match
  const exact = exactMatch(content, search)
  if (exact.found && exact.confidence === 'high') {
    return exact
  }

  // Strategy 2: Whitespace-normalized match
  const whitespace = whitespaceNormalizedMatch(content, search)
  if (whitespace.found && whitespace.confidence === 'high') {
    return whitespace
  }

  // Strategy 3: Fuzzy line match
  const fuzzy = fuzzyLineMatch(content, search, fuzzyThreshold)
  if (fuzzy.found && (fuzzy.confidence === 'high' || fuzzy.confidence === 'medium')) {
    return fuzzy
  }

  // Strategy 4: Anchor-based match
  const anchor = anchorMatch(content, search)
  if (anchor.found) {
    return anchor
  }

  // Return best partial match if any strategy found something
  if (exact.found) return exact
  if (whitespace.found) return whitespace
  if (fuzzy.found) return fuzzy

  return { found: false, strategy: 'none', confidence: 'none' }
}

/**
 * Apply a replacement using the match result.
 */
export function applyReplacement(
  content: string,
  match: MatchResult,
  replacement: string
): string {
  if (!match.found || match.startIndex === undefined || match.endIndex === undefined) {
    throw new Error('Cannot apply replacement: no valid match')
  }

  return (
    content.slice(0, match.startIndex) +
    replacement +
    content.slice(match.endIndex)
  )
}
