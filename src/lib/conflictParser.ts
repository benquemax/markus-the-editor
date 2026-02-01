/**
 * Git Conflict Parser
 *
 * Parses Git conflict markers from file content into structured data
 * for the conflict resolution UI. Also provides utilities to rebuild
 * the file after conflicts are resolved.
 */

/**
 * Represents a single conflict section in a file.
 * Each conflict has two versions: local (ours) and remote (theirs).
 */
export interface ConflictSection {
  id: string
  localContent: string
  remoteContent: string
  resolvedContent: string | null
}

/**
 * Represents all conflicts in a file along with the non-conflicting parts.
 */
export interface FileConflict {
  filePath: string
  sections: ConflictSection[]
  isResolved: boolean
  // Non-conflicting content before, between, and after conflicts
  nonConflictingParts: string[]
}

// Git uses these markers to denote conflict regions
const CONFLICT_START = '<<<<<<< '
const CONFLICT_SEPARATOR = '======='
const CONFLICT_END = '>>>>>>> '

/**
 * Parses Git conflict markers from file content.
 *
 * Git conflict format:
 * <<<<<<< HEAD (or local branch)
 * local content
 * =======
 * remote content
 * >>>>>>> remote-branch
 *
 * Returns structured conflict data that can be used by the resolution UI.
 */
export function parseConflicts(content: string, filePath: string): FileConflict {
  const lines = content.split('\n')
  const sections: ConflictSection[] = []
  const nonConflictingParts: string[] = []

  let currentNonConflict: string[] = []
  let inConflict = false
  let inLocalPart = false
  let localLines: string[] = []
  let remoteLines: string[] = []
  let conflictId = 0

  for (const line of lines) {
    if (line.startsWith(CONFLICT_START)) {
      // Starting a new conflict - save any non-conflict content
      nonConflictingParts.push(currentNonConflict.join('\n'))
      currentNonConflict = []
      inConflict = true
      inLocalPart = true
      localLines = []
      remoteLines = []
    } else if (line === CONFLICT_SEPARATOR && inConflict) {
      // Switch from local to remote content
      inLocalPart = false
    } else if (line.startsWith(CONFLICT_END) && inConflict) {
      // End of conflict section
      sections.push({
        id: `conflict-${conflictId++}`,
        localContent: localLines.join('\n'),
        remoteContent: remoteLines.join('\n'),
        resolvedContent: null
      })
      inConflict = false
    } else if (inConflict) {
      // Inside a conflict - add to appropriate side
      if (inLocalPart) {
        localLines.push(line)
      } else {
        remoteLines.push(line)
      }
    } else {
      // Outside any conflict
      currentNonConflict.push(line)
    }
  }

  // Add any remaining non-conflict content
  nonConflictingParts.push(currentNonConflict.join('\n'))

  return {
    filePath,
    sections,
    isResolved: false,
    nonConflictingParts
  }
}

/**
 * Checks if file content contains Git conflict markers.
 */
export function hasConflictMarkers(content: string): boolean {
  return content.includes(CONFLICT_START) &&
    content.includes(CONFLICT_SEPARATOR) &&
    content.includes(CONFLICT_END)
}

/**
 * Rebuilds the file content from resolved conflicts.
 * Interleaves non-conflicting parts with resolved conflict sections.
 */
export function rebuildFromConflicts(conflict: FileConflict): string {
  const parts: string[] = []

  for (let i = 0; i < conflict.nonConflictingParts.length; i++) {
    // Add non-conflicting part
    parts.push(conflict.nonConflictingParts[i])

    // Add resolved conflict if there is one at this position
    if (i < conflict.sections.length) {
      const section = conflict.sections[i]
      if (section.resolvedContent !== null) {
        parts.push(section.resolvedContent)
      } else {
        // If not resolved, keep the original conflict markers
        // This shouldn't happen in normal use but provides a fallback
        parts.push(`<<<<<<< LOCAL\n${section.localContent}\n=======\n${section.remoteContent}\n>>>>>>> REMOTE`)
      }
    }
  }

  return parts.join('\n')
}

/**
 * Checks if all conflicts in a FileConflict have been resolved.
 */
export function allConflictsResolved(conflict: FileConflict): boolean {
  return conflict.sections.every(section => section.resolvedContent !== null)
}

/**
 * Creates a copy of FileConflict with a specific section resolved.
 */
export function resolveSection(
  conflict: FileConflict,
  sectionId: string,
  resolvedContent: string
): FileConflict {
  const updatedSections = conflict.sections.map(section =>
    section.id === sectionId
      ? { ...section, resolvedContent }
      : section
  )

  return {
    ...conflict,
    sections: updatedSections,
    isResolved: updatedSections.every(s => s.resolvedContent !== null)
  }
}
