/**
 * File Tree Utility Tests
 *
 * Tests for the tree data structure helpers used by the file explorer.
 */

import { describe, it, expect } from 'vitest'
import {
  sortNodes,
  updateNodeInTree,
  findNodeByPath,
  getParentPath,
  getExpandedPaths,
  applyGitStatusToTree,
  FileTreeNode,
  GitStatus
} from './fileTree'

// --- Test data factories ---

function makeNode(overrides: Partial<FileTreeNode> & { path: string }): FileTreeNode {
  return {
    id: overrides.path,
    name: overrides.path.split('/').pop() || '',
    type: 'file',
    isExpanded: false,
    ...overrides
  }
}

function makeDir(path: string, children?: FileTreeNode[], isExpanded = false): FileTreeNode {
  return makeNode({ path, type: 'directory', children, isExpanded })
}

function makeFile(path: string): FileTreeNode {
  return makeNode({ path, type: 'file' })
}

// --- sortNodes ---

describe('sortNodes', () => {
  it('should sort directories before files', () => {
    const nodes = [
      makeFile('/root/b.md'),
      makeDir('/root/a-folder'),
      makeFile('/root/a.md'),
      makeDir('/root/z-folder')
    ]

    const sorted = sortNodes(nodes)

    expect(sorted[0].name).toBe('a-folder')
    expect(sorted[1].name).toBe('z-folder')
    expect(sorted[2].name).toBe('a.md')
    expect(sorted[3].name).toBe('b.md')
  })

  it('should sort alphabetically within the same type', () => {
    const nodes = [
      makeFile('/root/charlie.md'),
      makeFile('/root/alpha.md'),
      makeFile('/root/bravo.md')
    ]

    const sorted = sortNodes(nodes)

    expect(sorted.map(n => n.name)).toEqual(['alpha.md', 'bravo.md', 'charlie.md'])
  })

  it('should not mutate the original array', () => {
    const nodes = [makeFile('/root/b.md'), makeFile('/root/a.md')]
    const original = [...nodes]
    sortNodes(nodes)
    expect(nodes).toEqual(original)
  })
})

// --- updateNodeInTree ---

describe('updateNodeInTree', () => {
  it('should update a top-level node', () => {
    const tree = [makeFile('/root/a.md'), makeFile('/root/b.md')]

    const updated = updateNodeInTree(tree, '/root/a.md', n => ({
      ...n,
      gitStatus: 'modified' as GitStatus
    }))

    expect(updated[0].gitStatus).toBe('modified')
    expect(updated[1].gitStatus).toBeUndefined()
  })

  it('should update a nested node', () => {
    const tree = [
      makeDir('/root/folder', [
        makeFile('/root/folder/file.md')
      ], true)
    ]

    const updated = updateNodeInTree(tree, '/root/folder/file.md', n => ({
      ...n,
      gitStatus: 'added' as GitStatus
    }))

    expect(updated[0].children![0].gitStatus).toBe('added')
  })

  it('should leave unrelated nodes unchanged', () => {
    const tree = [makeFile('/root/a.md'), makeFile('/root/b.md')]

    const updated = updateNodeInTree(tree, '/root/nonexistent.md', n => ({
      ...n,
      gitStatus: 'modified' as GitStatus
    }))

    expect(updated[0].gitStatus).toBeUndefined()
    expect(updated[1].gitStatus).toBeUndefined()
  })

  it('should return new tree references (immutable)', () => {
    const original = [makeFile('/root/a.md')]
    const updated = updateNodeInTree(original, '/root/a.md', n => ({ ...n, gitStatus: 'modified' }))

    expect(updated).not.toBe(original)
    expect(updated[0]).not.toBe(original[0])
  })
})

// --- findNodeByPath ---

describe('findNodeByPath', () => {
  it('should find a top-level node', () => {
    const tree = [makeFile('/root/a.md'), makeFile('/root/b.md')]
    const found = findNodeByPath(tree, '/root/a.md')
    expect(found).not.toBeNull()
    expect(found!.name).toBe('a.md')
  })

  it('should find a deeply nested node', () => {
    const tree = [
      makeDir('/root/a', [
        makeDir('/root/a/b', [
          makeFile('/root/a/b/deep.md')
        ], true)
      ], true)
    ]

    const found = findNodeByPath(tree, '/root/a/b/deep.md')
    expect(found).not.toBeNull()
    expect(found!.name).toBe('deep.md')
  })

  it('should return null for non-existent path', () => {
    const tree = [makeFile('/root/a.md')]
    expect(findNodeByPath(tree, '/root/nonexistent.md')).toBeNull()
  })

  it('should return null for empty tree', () => {
    expect(findNodeByPath([], '/root/a.md')).toBeNull()
  })
})

// --- getParentPath ---

describe('getParentPath', () => {
  it('should return parent directory path', () => {
    expect(getParentPath('/root/folder/file.md')).toBe('/root/folder')
  })

  it('should return root for top-level path', () => {
    expect(getParentPath('/file.md')).toBe('')
  })

  it('should handle nested paths', () => {
    expect(getParentPath('/a/b/c/d')).toBe('/a/b/c')
  })
})

// --- getExpandedPaths ---

describe('getExpandedPaths', () => {
  it('should return empty array for no expanded nodes', () => {
    const tree = [makeDir('/root/a'), makeDir('/root/b')]
    expect(getExpandedPaths(tree)).toEqual([])
  })

  it('should return expanded directory paths', () => {
    const tree = [
      makeDir('/root/a', [makeFile('/root/a/file.md')], true),
      makeDir('/root/b', undefined, false)
    ]

    expect(getExpandedPaths(tree)).toEqual(['/root/a'])
  })

  it('should return nested expanded paths', () => {
    const tree = [
      makeDir('/root/a', [
        makeDir('/root/a/sub', [makeFile('/root/a/sub/file.md')], true)
      ], true)
    ]

    const expanded = getExpandedPaths(tree)
    expect(expanded).toContain('/root/a')
    expect(expanded).toContain('/root/a/sub')
  })

  it('should not include files', () => {
    const tree = [
      makeDir('/root/a', [makeFile('/root/a/file.md')], true),
      makeFile('/root/file.md')
    ]

    const expanded = getExpandedPaths(tree)
    expect(expanded).toEqual(['/root/a'])
  })
})

// --- applyGitStatusToTree ---

describe('applyGitStatusToTree', () => {
  it('should apply status to matching files', () => {
    const tree = [makeFile('/root/a.md'), makeFile('/root/b.md')]
    const statusMap = new Map<string, GitStatus>([
      ['/root/a.md', 'modified']
    ])

    const result = applyGitStatusToTree(tree, statusMap)
    expect(result[0].gitStatus).toBe('modified')
    expect(result[1].gitStatus).toBeNull()
  })

  it('should propagate status to parent directories', () => {
    const tree = [
      makeDir('/root/folder', [
        makeFile('/root/folder/file.md')
      ])
    ]
    const statusMap = new Map<string, GitStatus>([
      ['/root/folder/file.md', 'added']
    ])

    const result = applyGitStatusToTree(tree, statusMap)
    // Parent directory should get 'modified' status because a child has status
    expect(result[0].gitStatus).toBe('modified')
    expect(result[0].children![0].gitStatus).toBe('added')
  })

  it('should handle empty status map', () => {
    const tree = [makeFile('/root/a.md')]
    const statusMap = new Map<string, GitStatus>()

    const result = applyGitStatusToTree(tree, statusMap)
    expect(result[0].gitStatus).toBeNull()
  })
})
