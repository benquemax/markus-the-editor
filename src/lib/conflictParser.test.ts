/**
 * Tests for Git Conflict Parser
 */

import { describe, it, expect } from 'vitest'
import {
  parseConflicts,
  hasConflictMarkers,
  rebuildFromConflicts,
  allConflictsResolved,
  resolveSection
} from './conflictParser'

describe('conflictParser', () => {
  describe('hasConflictMarkers', () => {
    it('returns true when content has conflict markers', () => {
      const content = `Some text
<<<<<<< HEAD
local version
=======
remote version
>>>>>>> origin/main
More text`
      expect(hasConflictMarkers(content)).toBe(true)
    })

    it('returns false when content has no conflict markers', () => {
      const content = 'Just regular content without any conflicts.'
      expect(hasConflictMarkers(content)).toBe(false)
    })

    it('returns false when only partial markers exist', () => {
      const content = `<<<<<<< HEAD
local version
=======
missing end marker`
      expect(hasConflictMarkers(content)).toBe(false)
    })
  })

  describe('parseConflicts', () => {
    it('parses a single conflict section', () => {
      const content = `Before conflict
<<<<<<< HEAD
local content
=======
remote content
>>>>>>> origin/main
After conflict`

      const result = parseConflicts(content, '/test/file.md')

      expect(result.filePath).toBe('/test/file.md')
      expect(result.sections).toHaveLength(1)
      expect(result.sections[0].localContent).toBe('local content')
      expect(result.sections[0].remoteContent).toBe('remote content')
      expect(result.sections[0].resolvedContent).toBeNull()
      expect(result.nonConflictingParts).toHaveLength(2)
      expect(result.nonConflictingParts[0]).toBe('Before conflict')
      expect(result.nonConflictingParts[1]).toBe('After conflict')
    })

    it('parses multiple conflict sections', () => {
      const content = `Start
<<<<<<< HEAD
local1
=======
remote1
>>>>>>> origin/main
Middle
<<<<<<< HEAD
local2
=======
remote2
>>>>>>> origin/main
End`

      const result = parseConflicts(content, '/test/file.md')

      expect(result.sections).toHaveLength(2)
      expect(result.sections[0].localContent).toBe('local1')
      expect(result.sections[0].remoteContent).toBe('remote1')
      expect(result.sections[1].localContent).toBe('local2')
      expect(result.sections[1].remoteContent).toBe('remote2')
      expect(result.nonConflictingParts).toHaveLength(3)
      expect(result.nonConflictingParts[0]).toBe('Start')
      expect(result.nonConflictingParts[1]).toBe('Middle')
      expect(result.nonConflictingParts[2]).toBe('End')
    })

    it('handles multi-line content in conflicts', () => {
      const content = `<<<<<<< HEAD
line 1 local
line 2 local
line 3 local
=======
line 1 remote
line 2 remote
>>>>>>> origin/main`

      const result = parseConflicts(content, '/test/file.md')

      expect(result.sections[0].localContent).toBe('line 1 local\nline 2 local\nline 3 local')
      expect(result.sections[0].remoteContent).toBe('line 1 remote\nline 2 remote')
    })

    it('handles empty local content', () => {
      const content = `<<<<<<< HEAD
=======
remote only
>>>>>>> origin/main`

      const result = parseConflicts(content, '/test/file.md')

      expect(result.sections[0].localContent).toBe('')
      expect(result.sections[0].remoteContent).toBe('remote only')
    })

    it('handles empty remote content', () => {
      const content = `<<<<<<< HEAD
local only
=======
>>>>>>> origin/main`

      const result = parseConflicts(content, '/test/file.md')

      expect(result.sections[0].localContent).toBe('local only')
      expect(result.sections[0].remoteContent).toBe('')
    })
  })

  describe('resolveSection', () => {
    it('resolves a conflict section with new content', () => {
      const content = `<<<<<<< HEAD
local
=======
remote
>>>>>>> origin/main`

      const conflict = parseConflicts(content, '/test/file.md')
      const resolved = resolveSection(conflict, conflict.sections[0].id, 'merged content')

      expect(resolved.sections[0].resolvedContent).toBe('merged content')
      expect(resolved.isResolved).toBe(true)
    })

    it('marks conflict as resolved only when all sections are resolved', () => {
      const content = `<<<<<<< HEAD
local1
=======
remote1
>>>>>>> origin/main
middle
<<<<<<< HEAD
local2
=======
remote2
>>>>>>> origin/main`

      const conflict = parseConflicts(content, '/test/file.md')

      // Resolve first section only
      const partial = resolveSection(conflict, conflict.sections[0].id, 'resolved1')
      expect(partial.isResolved).toBe(false)

      // Resolve second section
      const full = resolveSection(partial, partial.sections[1].id, 'resolved2')
      expect(full.isResolved).toBe(true)
    })
  })

  describe('allConflictsResolved', () => {
    it('returns false when no sections are resolved', () => {
      const content = `<<<<<<< HEAD
local
=======
remote
>>>>>>> origin/main`

      const conflict = parseConflicts(content, '/test/file.md')
      expect(allConflictsResolved(conflict)).toBe(false)
    })

    it('returns true when all sections are resolved', () => {
      const content = `<<<<<<< HEAD
local
=======
remote
>>>>>>> origin/main`

      const conflict = parseConflicts(content, '/test/file.md')
      const resolved = resolveSection(conflict, conflict.sections[0].id, 'merged')
      expect(allConflictsResolved(resolved)).toBe(true)
    })
  })

  describe('rebuildFromConflicts', () => {
    it('rebuilds file from resolved conflicts', () => {
      const content = `Before
<<<<<<< HEAD
local
=======
remote
>>>>>>> origin/main
After`

      const conflict = parseConflicts(content, '/test/file.md')
      const resolved = resolveSection(conflict, conflict.sections[0].id, 'merged')
      const rebuilt = rebuildFromConflicts(resolved)

      expect(rebuilt).toBe('Before\nmerged\nAfter')
    })

    it('rebuilds file with multiple resolved conflicts', () => {
      const content = `Start
<<<<<<< HEAD
local1
=======
remote1
>>>>>>> origin/main
Middle
<<<<<<< HEAD
local2
=======
remote2
>>>>>>> origin/main
End`

      let conflict = parseConflicts(content, '/test/file.md')
      conflict = resolveSection(conflict, conflict.sections[0].id, 'merged1')
      conflict = resolveSection(conflict, conflict.sections[1].id, 'merged2')
      const rebuilt = rebuildFromConflicts(conflict)

      expect(rebuilt).toBe('Start\nmerged1\nMiddle\nmerged2\nEnd')
    })

    it('preserves original markers for unresolved sections', () => {
      const content = `<<<<<<< HEAD
local
=======
remote
>>>>>>> origin/main`

      const conflict = parseConflicts(content, '/test/file.md')
      const rebuilt = rebuildFromConflicts(conflict)

      // Unresolved sections keep conflict markers
      expect(rebuilt).toContain('<<<<<<< LOCAL')
      expect(rebuilt).toContain('=======')
      expect(rebuilt).toContain('>>>>>>> REMOTE')
    })
  })
})
