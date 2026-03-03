/**
 * markus_edit — Anchor-Based File Editing Tool
 *
 * Wraps the existing 4-tier fuzzy matching system (exact → whitespace →
 * fuzzy → anchor) as a Claude Agent SDK MCP tool. This is critical for
 * small local models that produce imprecise SEARCH/REPLACE blocks.
 */

import { findMatch, applyReplacement, MatchResult } from '../../agents/editor/fuzzyMatch'
import * as fs from 'fs/promises'
import * as path from 'path'

export interface EditInput {
  file: string
  search: string
  replace: string
  workspace: string
}

export interface EditOutput {
  success: boolean
  strategy: MatchResult['strategy']
  confidence: MatchResult['confidence']
  lineNumber?: number
  similarity?: number
  error?: string
}

/**
 * Validates that the file path is within the workspace (prevents path traversal).
 */
function isPathSafe(filePath: string, workspace: string): boolean {
  const resolved = path.resolve(workspace, filePath)
  return resolved.startsWith(path.resolve(workspace))
}

/**
 * Executes a SEARCH/REPLACE edit using anchor-based fuzzy matching.
 * Returns detailed match information so the orchestrator can assess quality.
 */
export async function executeEdit(input: EditInput): Promise<EditOutput> {
  const { file, search, replace, workspace } = input

  // Security: ensure path stays within workspace
  const filePath = path.isAbsolute(file) ? file : path.resolve(workspace, file)
  if (!isPathSafe(filePath, workspace)) {
    return { success: false, strategy: 'none', confidence: 'none', error: 'Path traversal blocked' }
  }

  // Read file content
  let content: string
  try {
    content = await fs.readFile(filePath, 'utf-8')
  } catch {
    // File doesn't exist — create it with the replacement content
    if (search.trim() === '') {
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, replace, 'utf-8')
      return { success: true, strategy: 'exact', confidence: 'high', lineNumber: 1 }
    }
    return { success: false, strategy: 'none', confidence: 'none', error: `File not found: ${file}` }
  }

  // Find match using 4-tier cascade
  const match = findMatch(content, search)

  if (!match.found) {
    return {
      success: false,
      strategy: match.strategy,
      confidence: 'none',
      similarity: match.similarity,
      error: `No match found for search text (best similarity: ${(match.similarity ?? 0).toFixed(2)})`
    }
  }

  // Apply replacement
  const newContent = applyReplacement(content, match, replace)
  await fs.writeFile(filePath, newContent, 'utf-8')

  return {
    success: true,
    strategy: match.strategy,
    confidence: match.confidence,
    lineNumber: match.lineNumber,
    similarity: match.similarity
  }
}
