/**
 * Edit Validator
 *
 * Validates SEARCH/REPLACE edit operations before applying them.
 * Ensures edits are safe, the target file exists, and the search
 * text can be uniquely identified.
 */

import fs from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { SearchReplaceEdit, EditResult } from '../types'
import { findMatch, MatchResult } from './fuzzyMatch'
import {
  validateWritePath,
  isFile,
  PathSecurityError
} from '../../security'

// ============================================================================
// Types
// ============================================================================

/**
 * Validation result for an edit operation.
 */
export interface EditValidation {
  /** Whether the edit is valid */
  valid: boolean
  /** File content (if valid) */
  content?: string
  /** Match result (if valid) */
  match?: MatchResult
  /** Error message (if invalid) */
  error?: string
  /** Warning message (if valid but risky) */
  warning?: string
}

/**
 * Options for edit validation.
 */
export interface ValidateOptions {
  /** Workspace folders for path validation */
  workspaceFolders: string[]
  /** Whether to allow creating new files */
  allowCreate?: boolean
  /** Minimum similarity threshold */
  minSimilarity?: number
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate an edit operation.
 */
export async function validateEdit(
  edit: SearchReplaceEdit,
  options: ValidateOptions
): Promise<EditValidation> {
  const { workspaceFolders, allowCreate = true, minSimilarity = 0.85 } = options

  // Validate file path
  let validatedPath: string
  try {
    validatedPath = validateWritePath(edit.file, workspaceFolders)
  } catch (error) {
    if (error instanceof PathSecurityError) {
      return {
        valid: false,
        error: `Security error: ${error.message}`
      }
    }
    return {
      valid: false,
      error: `Invalid path: ${edit.file}`
    }
  }

  // Check if this is a new file creation
  const isNewFile = !existsSync(validatedPath)

  if (isNewFile) {
    if (!allowCreate) {
      return {
        valid: false,
        error: `File does not exist: ${edit.file}`
      }
    }

    // For new files, search must be empty
    if (edit.search.trim()) {
      return {
        valid: false,
        error: 'For new files, search text must be empty'
      }
    }

    // Check parent directory exists
    const parentDir = path.dirname(validatedPath)
    if (!existsSync(parentDir)) {
      return {
        valid: false,
        error: `Parent directory does not exist: ${parentDir}`
      }
    }

    return {
      valid: true,
      content: '',
      match: {
        found: true,
        strategy: 'exact',
        startIndex: 0,
        endIndex: 0,
        lineNumber: 1,
        matchedText: '',
        similarity: 1,
        confidence: 'high'
      }
    }
  }

  // Read existing file
  if (!isFile(validatedPath)) {
    return {
      valid: false,
      error: `Not a file: ${edit.file}`
    }
  }

  let content: string
  try {
    content = await fs.readFile(validatedPath, 'utf-8')
  } catch (error) {
    return {
      valid: false,
      error: `Cannot read file: ${error}`
    }
  }

  // Empty search means append/replace entire file
  if (!edit.search.trim()) {
    return {
      valid: true,
      content,
      match: {
        found: true,
        strategy: 'exact',
        startIndex: 0,
        endIndex: content.length,
        lineNumber: 1,
        matchedText: content,
        similarity: 1,
        confidence: 'high'
      },
      warning: 'Empty search will replace entire file content'
    }
  }

  // Find match
  const match = findMatch(content, edit.search, {
    fuzzyThreshold: minSimilarity
  })

  if (!match.found) {
    return {
      valid: false,
      error: 'Search text not found in file'
    }
  }

  // Check confidence
  let warning: string | undefined
  if (match.confidence === 'low') {
    warning = `Low confidence match using ${match.strategy} strategy (similarity: ${match.similarity?.toFixed(2)})`
  } else if (match.confidence === 'medium') {
    warning = `Medium confidence match using ${match.strategy} strategy`
  }

  return {
    valid: true,
    content,
    match,
    warning
  }
}

/**
 * Apply a validated edit.
 */
export async function applyEdit(
  edit: SearchReplaceEdit,
  validation: EditValidation
): Promise<EditResult> {
  if (!validation.valid || !validation.match) {
    return {
      success: false,
      error: validation.error || 'Invalid edit'
    }
  }

  const { match, content } = validation

  // Calculate new content
  let newContent: string
  if (!content && !edit.search.trim()) {
    // New file
    newContent = edit.replace
  } else if (match.startIndex !== undefined && match.endIndex !== undefined) {
    // Replace matched text
    newContent =
      content!.slice(0, match.startIndex) +
      edit.replace +
      content!.slice(match.endIndex)
  } else {
    return {
      success: false,
      error: 'Invalid match result'
    }
  }

  // Write file
  try {
    await fs.writeFile(edit.file, newContent, 'utf-8')
  } catch (error) {
    return {
      success: false,
      error: `Failed to write file: ${error}`
    }
  }

  return {
    success: true,
    matchStrategy: match.strategy,
    lineNumber: match.lineNumber,
    similarity: match.similarity
  }
}

/**
 * Validate multiple edits for a batch operation.
 */
export async function validateEditBatch(
  edits: SearchReplaceEdit[],
  options: ValidateOptions
): Promise<Map<number, EditValidation>> {
  const results = new Map<number, EditValidation>()

  // Group edits by file
  const editsByFile = new Map<string, { index: number; edit: SearchReplaceEdit }[]>()
  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i]
    const existing = editsByFile.get(edit.file) || []
    existing.push({ index: i, edit })
    editsByFile.set(edit.file, existing)
  }

  // Validate each file's edits
  for (const fileEdits of editsByFile.values()) {
    // Check for conflicting edits to the same file
    if (fileEdits.length > 1) {
      // Read file once
      const firstValidation = await validateEdit(fileEdits[0].edit, options)

      if (!firstValidation.valid) {
        for (const { index } of fileEdits) {
          results.set(index, firstValidation)
        }
        continue
      }

      // Check for overlapping edits
      const allMatches: Array<{ index: number; match: MatchResult }> = []

      for (const { index, edit } of fileEdits) {
        const validation = await validateEdit(edit, options)
        results.set(index, validation)

        if (validation.match && validation.match.found) {
          allMatches.push({ index, match: validation.match })
        }
      }

      // Check for overlaps
      for (let i = 0; i < allMatches.length; i++) {
        for (let j = i + 1; j < allMatches.length; j++) {
          const a = allMatches[i].match
          const b = allMatches[j].match

          if (
            a.startIndex !== undefined &&
            a.endIndex !== undefined &&
            b.startIndex !== undefined &&
            b.endIndex !== undefined
          ) {
            // Check overlap
            if (
              (a.startIndex <= b.startIndex && b.startIndex < a.endIndex) ||
              (b.startIndex <= a.startIndex && a.startIndex < b.endIndex)
            ) {
              results.set(allMatches[j].index, {
                valid: false,
                error: 'Edit overlaps with another edit to the same file'
              })
            }
          }
        }
      }
    } else {
      // Single edit to file
      const validation = await validateEdit(fileEdits[0].edit, options)
      results.set(fileEdits[0].index, validation)
    }
  }

  return results
}
