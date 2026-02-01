/**
 * File Tree Types and Utilities
 *
 * Provides TypeScript interfaces and helper functions for the file explorer tree.
 * The tree structure supports lazy-loading of subdirectories and git status tracking.
 */

export type GitStatus = 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed' | null

/**
 * Represents a node in the file tree (either a file or directory).
 */
export interface FileTreeNode {
  id: string                    // Absolute path, used as unique identifier
  name: string                  // Display name (file/folder name)
  path: string                  // Absolute path
  type: 'file' | 'directory'
  children?: FileTreeNode[]     // Only present for directories that have been loaded
  isExpanded?: boolean          // Whether this directory is expanded in the UI
  gitStatus?: GitStatus         // Git status for this file/directory
  isLoading?: boolean           // Whether children are currently being loaded
}

/**
 * Diff block for editor highlighting
 */
export interface DiffBlock {
  startLine: number
  endLine: number
  type: 'added' | 'modified'
}

/**
 * Sorts file tree nodes: directories first, then files, both alphabetically.
 */
export function sortNodes(nodes: FileTreeNode[]): FileTreeNode[] {
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1
    }
    return a.name.localeCompare(b.name)
  })
}

/**
 * Updates a node in the tree by path.
 * Returns a new tree with the updated node.
 */
export function updateNodeInTree(
  nodes: FileTreeNode[],
  targetPath: string,
  updater: (node: FileTreeNode) => FileTreeNode
): FileTreeNode[] {
  return nodes.map(node => {
    if (node.path === targetPath) {
      return updater(node)
    }

    if (node.children && targetPath.startsWith(node.path + '/')) {
      return {
        ...node,
        children: updateNodeInTree(node.children, targetPath, updater)
      }
    }

    return node
  })
}

/**
 * Finds a node in the tree by path.
 */
export function findNodeByPath(nodes: FileTreeNode[], targetPath: string): FileTreeNode | null {
  for (const node of nodes) {
    if (node.path === targetPath) {
      return node
    }

    if (node.children && targetPath.startsWith(node.path + '/')) {
      const found = findNodeByPath(node.children, targetPath)
      if (found) return found
    }
  }

  return null
}

/**
 * Gets the parent path of a file path.
 */
export function getParentPath(filePath: string): string {
  const lastSlash = filePath.lastIndexOf('/')
  return lastSlash > 0 ? filePath.slice(0, lastSlash) : ''
}

/**
 * Applies git status to nodes in the tree.
 * Also propagates status to parent directories (a directory is "modified" if it contains modified files).
 */
export function applyGitStatusToTree(
  nodes: FileTreeNode[],
  statusMap: Map<string, GitStatus>
): FileTreeNode[] {
  return nodes.map(node => {
    const status = statusMap.get(node.path) || null

    if (node.type === 'directory' && node.children) {
      const updatedChildren = applyGitStatusToTree(node.children, statusMap)

      // Directory inherits status if any child has a status
      const childHasStatus = updatedChildren.some(child => child.gitStatus !== null)

      return {
        ...node,
        children: updatedChildren,
        gitStatus: status || (childHasStatus ? 'modified' : null)
      }
    }

    return {
      ...node,
      gitStatus: status
    }
  })
}

/**
 * Checks if a file path matches a markdown file extension.
 */
export function isMarkdownFile(filePath: string): boolean {
  const ext = filePath.toLowerCase().split('.').pop()
  return ext === 'md' || ext === 'markdown'
}

/**
 * Gets the file extension from a file path.
 */
export function getFileExtension(filePath: string): string {
  const parts = filePath.split('.')
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : ''
}

/**
 * Collects all expanded paths from the tree.
 * Used for persisting the expanded state.
 */
export function getExpandedPaths(nodes: FileTreeNode[]): string[] {
  const paths: string[] = []

  function traverse(nodeList: FileTreeNode[]) {
    for (const node of nodeList) {
      if (node.type === 'directory' && node.isExpanded) {
        paths.push(node.path)
        if (node.children) {
          traverse(node.children)
        }
      }
    }
  }

  traverse(nodes)
  return paths
}
