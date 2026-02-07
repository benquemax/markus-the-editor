/**
 * Editor Agent Module
 *
 * Exports editor-related functionality for file modifications
 * using SEARCH/REPLACE blocks with fuzzy matching.
 */

// Fuzzy matching
export {
  findMatch,
  applyReplacement,
  type MatchResult,
  type MatchOptions
} from './fuzzyMatch'

// Validation
export {
  validateEdit,
  applyEdit,
  validateEditBatch,
  type EditValidation,
  type ValidateOptions
} from './validator'

// Editor agent
export {
  EditorAgent,
  createEditorAgent,
  parseEdits
} from './editorAgent'
