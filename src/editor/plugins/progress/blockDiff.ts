/**
 * Block Diff Algorithm
 *
 * Compares two ProseMirror documents at the block level to produce an
 * ordered list of alignments. Uses LCS (Longest Common Subsequence) for
 * exact matches, then greedy similarity matching for modified blocks.
 * Also provides word-level diffing for inline change highlighting.
 */

import { Node as ProseMirrorNode } from 'prosemirror-model'
import { markdownSerializer } from '../../markdown'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BlockStatus =
  | 'unchanged'
  | 'modified'
  | 'added'
  | 'deleted'

export interface BlockAlignment {
  status: BlockStatus
  /** Index in the current doc's top-level children (null for deleted blocks) */
  currentIndex: number | null
  /** Index in the committed doc's top-level children (null for added blocks) */
  committedIndex: number | null
  /** Word-level diff segments — populated for 'modified' status */
  wordDiff?: WordDiffSegment[]
}

export interface WordDiffSegment {
  type: 'keep' | 'removed' | 'added'
  text: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract top-level block nodes from a doc as an array. */
function extractBlocks(doc: ProseMirrorNode): ProseMirrorNode[] {
  const blocks: ProseMirrorNode[] = []
  for (let i = 0; i < doc.childCount; i++) {
    blocks.push(doc.child(i))
  }
  return blocks
}

/**
 * Serializes a single block node to markdown text for comparison.
 * Wraps the block in a temporary doc so the serializer can process it.
 */
function serializeBlock(block: ProseMirrorNode): string {
  const tempDoc = block.type.schema.nodes.doc.create(null, block)
  return markdownSerializer.serialize(tempDoc).trim()
}

/**
 * Computes the Longest Common Subsequence table for two string arrays.
 * Returns the LCS length table (dimensions [a.length+1][b.length+1]).
 */
function lcsTable(a: string[], b: string[]): number[][] {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }
  return dp
}

/**
 * Backtracks through the LCS table to find matched index pairs.
 * Returns an array of [indexInA, indexInB] tuples for matched elements.
 */
function lcsBacktrack(dp: number[][], a: string[], b: string[]): [number, number][] {
  const result: [number, number][] = []
  let i = a.length
  let j = b.length

  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.push([i - 1, j - 1])
      i--
      j--
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--
    } else {
      j--
    }
  }
  return result.reverse()
}

/**
 * Computes word-level similarity between two strings.
 * Returns a number between 0 (completely different) and 1 (identical).
 */
function wordSimilarity(a: string, b: string): number {
  const wordsA = a.split(/\s+/).filter(Boolean)
  const wordsB = b.split(/\s+/).filter(Boolean)
  if (wordsA.length === 0 && wordsB.length === 0) return 1
  if (wordsA.length === 0 || wordsB.length === 0) return 0

  const dp = lcsTable(wordsA, wordsB)
  const lcsLen = dp[wordsA.length][wordsB.length]
  return (2 * lcsLen) / (wordsA.length + wordsB.length)
}

// ---------------------------------------------------------------------------
// Block Diff
// ---------------------------------------------------------------------------

/** Similarity threshold: below this, treat as delete + add rather than modify */
const MATCH_THRESHOLD = 0.3

/**
 * Computes block-level diff between the current and committed ProseMirror docs.
 *
 * Algorithm:
 * 1. Serialize each top-level block to markdown.
 * 2. LCS on exact text equality → unchanged blocks.
 * 3. Greedy similarity matching on remaining → modified blocks.
 * 4. Unmatched blocks → added or deleted.
 * 5. For inline-modified blocks, compute word-level diff.
 * 6. Return alignments ordered by document position.
 */
export function computeBlockDiff(
  currentDoc: ProseMirrorNode,
  committedDoc: ProseMirrorNode
): BlockAlignment[] {
  const currentBlocks = extractBlocks(currentDoc)
  const committedBlocks = extractBlocks(committedDoc)

  const currentTexts = currentBlocks.map(serializeBlock)
  const committedTexts = committedBlocks.map(serializeBlock)

  // Step 1: LCS for exact matches → unchanged blocks
  const dp = lcsTable(currentTexts, committedTexts)
  const exactMatches = lcsBacktrack(dp, currentTexts, committedTexts)

  const matchedCurrent = new Set(exactMatches.map(([ci]) => ci))
  const matchedCommitted = new Set(exactMatches.map(([, ci]) => ci))

  // Step 2: Greedy similarity matching for remaining blocks
  const unmatchedCurrent = currentBlocks
    .map((_, i) => i)
    .filter(i => !matchedCurrent.has(i))
  const unmatchedCommitted = committedBlocks
    .map((_, i) => i)
    .filter(i => !matchedCommitted.has(i))

  const modifiedPairs: [number, number][] = [] // [currentIdx, committedIdx]
  const usedCommitted = new Set<number>()

  for (const ci of unmatchedCurrent) {
    let bestIdx = -1
    let bestSim = MATCH_THRESHOLD

    for (const ki of unmatchedCommitted) {
      if (usedCommitted.has(ki)) continue
      const sim = wordSimilarity(currentTexts[ci], committedTexts[ki])
      if (sim > bestSim) {
        bestSim = sim
        bestIdx = ki
      }
    }

    if (bestIdx >= 0) {
      modifiedPairs.push([ci, bestIdx])
      usedCommitted.add(bestIdx)
      matchedCurrent.add(ci)
      matchedCommitted.add(bestIdx)
    }
  }

  // Step 3: Build the ordered alignment list
  // We interleave committed-only (deleted) blocks at their relative positions.

  // Build a position map: for each committed index, where does it appear
  // relative to the matched/modified committed blocks?
  // Strategy: walk committed blocks in order. For each, if it's matched or
  // modified, record which current block it maps to. If unmatched (deleted),
  // record it as deleted at the position of the next matched current block.

  const committedToCurrent = new Map<number, number>()
  for (const [ci, ki] of exactMatches) {
    committedToCurrent.set(ki, ci)
  }
  for (const [ci, ki] of modifiedPairs) {
    committedToCurrent.set(ki, ci)
  }

  // Determine the insertion point for deleted blocks:
  // A deleted block at committed index ki should appear just before the next
  // current block that maps to a committed index > ki.
  const deletedCommitted = committedBlocks
    .map((_, i) => i)
    .filter(i => !matchedCommitted.has(i))

  // For each deleted committed block, find the current index it should precede
  const deletedInsertions: Map<number, number[]> = new Map() // currentIdx → [committedIdx...]
  for (const ki of deletedCommitted) {
    // Find the next committed block after ki that IS matched
    let insertBefore: number | null = null
    for (let j = ki + 1; j < committedBlocks.length; j++) {
      if (committedToCurrent.has(j)) {
        insertBefore = committedToCurrent.get(j)!
        break
      }
    }
    // If no later match, insert at end (represented by currentBlocks.length)
    const key = insertBefore ?? currentBlocks.length
    if (!deletedInsertions.has(key)) deletedInsertions.set(key, [])
    deletedInsertions.get(key)!.push(ki)
  }

  // Step 4: Build the final alignment array by walking current blocks in order
  const alignments: BlockAlignment[] = []

  // Reverse map: current → committed for modified pairs
  const currentToCommitted = new Map<number, number>()
  for (const [ci, ki] of modifiedPairs) {
    currentToCommitted.set(ci, ki)
  }

  for (let ci = 0; ci <= currentBlocks.length; ci++) {
    // Insert any deleted blocks that belong before this position
    const deleted = deletedInsertions.get(ci)
    if (deleted) {
      for (const ki of deleted) {
        alignments.push({
          status: 'deleted',
          currentIndex: null,
          committedIndex: ki
        })
      }
    }

    if (ci >= currentBlocks.length) break

    if (matchedCurrent.has(ci) && !currentToCommitted.has(ci)) {
      // Exact match → unchanged
      alignments.push({
        status: 'unchanged',
        currentIndex: ci,
        committedIndex: exactMatches.find(([c]) => c === ci)![1]
      })
    } else if (currentToCommitted.has(ci)) {
      // Modified block — compute word-level diff for highlighting
      const ki = currentToCommitted.get(ci)!
      alignments.push({
        status: 'modified',
        currentIndex: ci,
        committedIndex: ki,
        wordDiff: computeWordDiff(
          committedBlocks[ki].textContent,
          currentBlocks[ci].textContent
        )
      })
    } else {
      // Not matched at all → added
      alignments.push({
        status: 'added',
        currentIndex: ci,
        committedIndex: null
      })
    }
  }

  return alignments
}

// ---------------------------------------------------------------------------
// Word Diff
// ---------------------------------------------------------------------------

/**
 * Splits text into tokens that preserve whitespace for faithful reconstruction.
 * Each token is either a word or a whitespace run.
 */
function tokenize(text: string): string[] {
  return text.match(/\S+|\s+/g) || []
}

/**
 * Computes word-level diff between old and new text.
 * Returns segments of kept, removed, and added text.
 */
export function computeWordDiff(oldText: string, newText: string): WordDiffSegment[] {
  const oldTokens = tokenize(oldText)
  const newTokens = tokenize(newText)

  const dp = lcsTable(oldTokens, newTokens)
  const matches = lcsBacktrack(dp, oldTokens, newTokens)

  const segments: WordDiffSegment[] = []
  let oi = 0
  let ni = 0

  for (const [mo, mn] of matches) {
    // Tokens before this match in old → removed
    if (oi < mo) {
      segments.push({ type: 'removed', text: oldTokens.slice(oi, mo).join('') })
    }
    // Tokens before this match in new → added
    if (ni < mn) {
      segments.push({ type: 'added', text: newTokens.slice(ni, mn).join('') })
    }
    // The matched token itself → keep
    segments.push({ type: 'keep', text: oldTokens[mo] })
    oi = mo + 1
    ni = mn + 1
  }

  // Remaining tokens after last match
  if (oi < oldTokens.length) {
    segments.push({ type: 'removed', text: oldTokens.slice(oi).join('') })
  }
  if (ni < newTokens.length) {
    segments.push({ type: 'added', text: newTokens.slice(ni).join('') })
  }

  return segments
}
