/**
 * File Tree Component
 *
 * Recursively renders the file tree structure using FileTreeItem components.
 * Handles keyboard navigation with arrow keys and Enter.
 */

import { useRef, useEffect, useCallback } from 'react'
import { FileTreeNode } from '../../lib/fileTree'
import { FileTreeItem } from './FileTreeItem'

interface FileTreeProps {
  nodes: FileTreeNode[]
  selectedPath: string | null
  onSelect: (node: FileTreeNode) => void
  onToggleExpand: (node: FileTreeNode) => void
  onOpenFile: (node: FileTreeNode) => void
  onNewFile?: (parentPath: string) => void
  onNewFolder?: (parentPath: string) => void
}

/**
 * Flattens the tree into a list of visible nodes (for keyboard navigation).
 */
function flattenVisibleNodes(nodes: FileTreeNode[]): FileTreeNode[] {
  const result: FileTreeNode[] = []

  function traverse(nodeList: FileTreeNode[]) {
    for (const node of nodeList) {
      result.push(node)
      if (node.type === 'directory' && node.isExpanded && node.children) {
        traverse(node.children)
      }
    }
  }

  traverse(nodes)
  return result
}

export function FileTree({
  nodes,
  selectedPath,
  onSelect,
  onToggleExpand,
  onOpenFile,
  onNewFile,
  onNewFolder
}: FileTreeProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const visibleNodes = flattenVisibleNodes(nodes)
    const currentIndex = visibleNodes.findIndex(n => n.path === selectedPath)

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault()
        const nextIndex = Math.min(currentIndex + 1, visibleNodes.length - 1)
        if (nextIndex >= 0 && visibleNodes[nextIndex]) {
          onSelect(visibleNodes[nextIndex])
        }
        break
      }
      case 'ArrowUp': {
        e.preventDefault()
        const prevIndex = Math.max(currentIndex - 1, 0)
        if (prevIndex >= 0 && visibleNodes[prevIndex]) {
          onSelect(visibleNodes[prevIndex])
        }
        break
      }
      case 'ArrowRight': {
        e.preventDefault()
        if (currentIndex >= 0) {
          const node = visibleNodes[currentIndex]
          if (node.type === 'directory' && !node.isExpanded) {
            onToggleExpand(node)
          }
        }
        break
      }
      case 'ArrowLeft': {
        e.preventDefault()
        if (currentIndex >= 0) {
          const node = visibleNodes[currentIndex]
          if (node.type === 'directory' && node.isExpanded) {
            onToggleExpand(node)
          }
        }
        break
      }
      case 'Enter': {
        e.preventDefault()
        if (currentIndex >= 0) {
          const node = visibleNodes[currentIndex]
          if (node.type === 'directory') {
            onToggleExpand(node)
          } else {
            onOpenFile(node)
          }
        }
        break
      }
    }
  }, [nodes, selectedPath, onSelect, onToggleExpand, onOpenFile])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    container.addEventListener('keydown', handleKeyDown)
    return () => container.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const renderNodes = (nodeList: FileTreeNode[], depth: number = 0) => {
    return nodeList.map(node => (
      <div key={node.path}>
        <FileTreeItem
          node={node}
          depth={depth}
          isSelected={node.path === selectedPath}
          onSelect={onSelect}
          onToggleExpand={onToggleExpand}
          onDoubleClick={onOpenFile}
          onNewFile={onNewFile}
          onNewFolder={onNewFolder}
        />
        {node.type === 'directory' && node.isExpanded && node.children && (
          renderNodes(node.children, depth + 1)
        )}
      </div>
    ))
  }

  return (
    <div
      ref={containerRef}
      className="py-1 focus:outline-none"
      tabIndex={0}
    >
      {renderNodes(nodes)}
    </div>
  )
}
