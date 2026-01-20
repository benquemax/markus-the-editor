/**
 * Collapse plugin for the editor.
 * Allows collapsing sections under headings and nested content in list items.
 *
 * Headings: Clicking the collapse indicator hides all content until the next
 * heading of the same or higher level.
 *
 * List items: Clicking the collapse indicator hides nested lists and other
 * block content within the list item.
 */
import { Plugin, PluginKey, EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view'
import { Node } from 'prosemirror-model'
import { schema } from '../schema'

// Use a unique identifier for collapsed nodes based on their content
type CollapseId = string

interface CollapseState {
  collapsed: Set<CollapseId>
}

export const collapsePluginKey = new PluginKey<CollapseState>('collapse')

/**
 * Generate a unique ID for a collapsible node.
 * Uses node type + position + text preview for uniqueness.
 */
function getCollapseId(node: Node, pos: number): CollapseId {
  const textPreview = node.textContent.slice(0, 20).replace(/\s+/g, ' ')
  return `${node.type.name}-${pos}-${textPreview}`
}

/**
 * Check if a list item has collapsible content (nested blocks beyond first paragraph).
 */
function hasCollapsibleContent(listItem: Node): boolean {
  return listItem.childCount > 1
}

/**
 * Create decorations for collapsible elements.
 */
function createDecorations(state: EditorState, collapsed: Set<CollapseId>): DecorationSet {
  const decorations: Decoration[] = []
  const doc = state.doc

  // Track which heading sections are collapsed
  // Map of heading position -> { level, endPos, collapseId }
  const collapsedHeadings: Map<number, { level: number; endPos: number; collapseId: CollapseId }> = new Map()

  // First pass: find all headings and determine collapsed sections
  doc.forEach((node, offset) => {
    if (node.type === schema.nodes.heading) {
      const collapseId = getCollapseId(node, offset)
      if (collapsed.has(collapseId)) {
        const level = node.attrs.level
        // Find end of this heading's section
        let endPos = doc.content.size
        doc.nodesBetween(offset + node.nodeSize, doc.content.size, (n, pos) => {
          if (n.type === schema.nodes.heading && n.attrs.level <= level) {
            endPos = pos
            return false
          }
          return true
        })
        collapsedHeadings.set(offset, { level, endPos, collapseId })
      }
    }
  })

  // Second pass: create decorations
  doc.forEach((node, offset) => {
    // Handle headings
    if (node.type === schema.nodes.heading) {
      const collapseId = getCollapseId(node, offset)
      const isCollapsed = collapsed.has(collapseId)
      const level = node.attrs.level

      // Add collapse indicator widget inside the heading (at start of content)
      const indicatorWidget = Decoration.widget(offset + 1, (view) => {
        const indicator = document.createElement('span')
        indicator.className = `collapse-indicator collapse-indicator-heading ${isCollapsed ? 'collapsed' : 'expanded'}`
        indicator.textContent = isCollapsed ? '▶' : '▼'
        indicator.title = isCollapsed ? 'Expand section' : 'Collapse section'
        indicator.addEventListener('mousedown', (e) => {
          e.preventDefault()
          e.stopPropagation()
          toggleCollapse(view, collapseId)
        })
        return indicator
      }, { side: -1 })

      decorations.push(indicatorWidget)

      // Add class to heading
      decorations.push(
        Decoration.node(offset, offset + node.nodeSize, {
          class: `collapsible-heading collapsible-heading-${level} ${isCollapsed ? 'is-collapsed' : ''}`
        })
      )
    }

    // Check if this node should be hidden (inside a collapsed heading section)
    for (const [headingPos, { level: collapsedLevel, endPos }] of collapsedHeadings) {
      const sectionStart = headingPos + doc.nodeAt(headingPos)!.nodeSize
      if (offset >= sectionStart && offset < endPos) {
        // Hide this node if:
        // - It's not a heading, OR
        // - It's a heading with a lower priority (higher level number) than the collapsed heading
        const shouldHide = node.type !== schema.nodes.heading ||
          node.attrs.level > collapsedLevel

        if (shouldHide) {
          decorations.push(
            Decoration.node(offset, offset + node.nodeSize, {
              class: 'collapsed-content'
            })
          )
          break
        }
      }
    }
  })

  // Handle list items (need to traverse into lists)
  doc.descendants((node, pos) => {
    if (node.type === schema.nodes.list_item && hasCollapsibleContent(node)) {
      const collapseId = getCollapseId(node, pos)
      const isCollapsed = collapsed.has(collapseId)

      // Add collapse indicator
      const indicatorWidget = Decoration.widget(pos + 1, (view) => {
        const indicator = document.createElement('span')
        indicator.className = `collapse-indicator collapse-indicator-list ${isCollapsed ? 'collapsed' : 'expanded'}`
        indicator.textContent = isCollapsed ? '▶' : '▼'
        indicator.title = isCollapsed ? 'Expand item' : 'Collapse item'
        indicator.addEventListener('mousedown', (e) => {
          e.preventDefault()
          e.stopPropagation()
          toggleCollapse(view, collapseId)
        })
        return indicator
      }, { side: -1 })

      decorations.push(indicatorWidget)

      // Add class to list item
      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, {
          class: `collapsible-list-item ${isCollapsed ? 'is-collapsed' : ''}`
        })
      )

      // If collapsed, hide nested content (everything after first child)
      if (isCollapsed && node.childCount > 1) {
        let childOffset = pos + 1 + node.firstChild!.nodeSize
        for (let i = 1; i < node.childCount; i++) {
          const child = node.child(i)
          decorations.push(
            Decoration.node(childOffset, childOffset + child.nodeSize, {
              class: 'collapsed-content'
            })
          )
          childOffset += child.nodeSize
        }
      }
    }

    return true
  })

  return DecorationSet.create(doc, decorations)
}

/**
 * Toggle collapse state for a node.
 */
function toggleCollapse(view: EditorView, collapseId: CollapseId) {
  const pluginState = collapsePluginKey.getState(view.state)
  if (!pluginState) return

  const newCollapsed = new Set(pluginState.collapsed)

  if (newCollapsed.has(collapseId)) {
    newCollapsed.delete(collapseId)
  } else {
    newCollapsed.add(collapseId)
  }

  const tr = view.state.tr.setMeta(collapsePluginKey, { collapsed: newCollapsed })
  view.dispatch(tr)
}

/**
 * Create the collapse plugin.
 */
export function createCollapsePlugin(): Plugin<CollapseState> {
  return new Plugin<CollapseState>({
    key: collapsePluginKey,

    state: {
      init(): CollapseState {
        return { collapsed: new Set() }
      },

      apply(tr, value): CollapseState {
        const meta = tr.getMeta(collapsePluginKey)
        if (meta) {
          return meta
        }
        return value
      }
    },

    props: {
      decorations(state) {
        const pluginState = collapsePluginKey.getState(state)
        if (!pluginState) return DecorationSet.empty
        return createDecorations(state, pluginState.collapsed)
      }
    }
  })
}
