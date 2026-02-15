import { Plugin, PluginKey } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { setBlockType, wrapIn } from 'prosemirror-commands'
import { schema } from '../schema'
import { wrapInList } from 'prosemirror-schema-list'
import { getNextImageNumber, buildImagePath } from '../../lib/imageBlock'

export interface SlashMenuItem {
  id: string
  label: string
  description: string
  icon: string
  action: (view: EditorView) => void
}

const slashMenuItems: SlashMenuItem[] = [
  {
    id: 'paragraph',
    label: 'Text',
    description: 'Plain text paragraph',
    icon: 'T',
    action: (view) => {
      setBlockType(schema.nodes.paragraph)(view.state, view.dispatch)
      view.focus()
    }
  },
  {
    id: 'heading1',
    label: 'Heading 1',
    description: 'Large section heading',
    icon: 'H1',
    action: (view) => {
      setBlockType(schema.nodes.heading, { level: 1 })(view.state, view.dispatch)
      view.focus()
    }
  },
  {
    id: 'heading2',
    label: 'Heading 2',
    description: 'Medium section heading',
    icon: 'H2',
    action: (view) => {
      setBlockType(schema.nodes.heading, { level: 2 })(view.state, view.dispatch)
      view.focus()
    }
  },
  {
    id: 'heading3',
    label: 'Heading 3',
    description: 'Small section heading',
    icon: 'H3',
    action: (view) => {
      setBlockType(schema.nodes.heading, { level: 3 })(view.state, view.dispatch)
      view.focus()
    }
  },
  {
    id: 'bullet_list',
    label: 'Bullet List',
    description: 'Unordered list with bullets',
    icon: '•',
    action: (view) => {
      wrapInList(schema.nodes.bullet_list)(view.state, view.dispatch)
      view.focus()
    }
  },
  {
    id: 'ordered_list',
    label: 'Numbered List',
    description: 'Ordered list with numbers',
    icon: '1.',
    action: (view) => {
      wrapInList(schema.nodes.ordered_list)(view.state, view.dispatch)
      view.focus()
    }
  },
  {
    id: 'blockquote',
    label: 'Quote',
    description: 'Block quotation',
    icon: '"',
    action: (view) => {
      wrapIn(schema.nodes.blockquote)(view.state, view.dispatch)
      view.focus()
    }
  },
  {
    id: 'code_block',
    label: 'Code Block',
    description: 'Code snippet with syntax highlighting',
    icon: '</>',
    action: (view) => {
      setBlockType(schema.nodes.code_block)(view.state, view.dispatch)
      view.focus()
    }
  },
  {
    id: 'horizontal_rule',
    label: 'Divider',
    description: 'Horizontal line separator',
    icon: '—',
    action: (view) => {
      const { state, dispatch } = view
      const { tr } = state
      dispatch(tr.replaceSelectionWith(schema.nodes.horizontal_rule.create()).scrollIntoView())
      view.focus()
    }
  },
  {
    id: 'mermaid',
    label: 'Mermaid Diagram',
    description: 'Flowcharts, sequence diagrams, and more',
    icon: '◇',
    action: (view) => {
      const { state, dispatch } = view
      const { tr } = state
      // Insert a mermaid code block with a starter flowchart template
      const starterTemplate = `graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Action 1]
    B -->|No| D[Action 2]
    C --> E[End]
    D --> E`
      const node = schema.nodes.code_block.create(
        { language: 'mermaid' },
        schema.text(starterTemplate)
      )
      dispatch(tr.replaceSelectionWith(node).scrollIntoView())
      view.focus()
    }
  },
  {
    id: 'image',
    label: 'Image',
    description: 'Insert image from file',
    icon: '🖼',
    action: (view) => {
      // Use a hidden file input to trigger the native file picker
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) return

        // Need the document's file path to save the image next to it
        const filePath = await window.electron.file.getCurrentPath()
        if (!filePath) {
          await window.electron.dialog.showMessage({
            type: 'info',
            title: 'Save Document First',
            message: 'Please save the document before adding images. Images are stored in a folder next to the document.',
            buttons: ['OK']
          })
          return
        }

        // Read file as base64
        const reader = new FileReader()
        reader.onload = async () => {
          const base64 = (reader.result as string).split(',')[1]
          const ext = file.name.split('.').pop()?.toLowerCase() || 'png'

          const docFileName = filePath.substring(filePath.lastIndexOf('/') + 1)
          const baseName = docFileName.replace(/\.md$/i, '')

          const { dirPath } = buildImagePath(filePath, ext, 1)
          const listResult = await window.electron.explorer.listFiles(dirPath)
          const existingFiles = listResult.success && listResult.files ? listResult.files : []
          const nextNum = getNextImageNumber(existingFiles, baseName)

          const imagePath = buildImagePath(filePath, ext, nextNum)
          const saveResult = await window.electron.explorer.saveBinaryFile(imagePath.filePath, base64)

          if (!saveResult.success) return

          const imageNode = schema.nodes.image_block.create({
            src: imagePath.relativeSrc,
            alt: file.name.replace(/\.[^.]+$/, ''),
            width: 'full',
            align: 'center'
          })

          const { state, dispatch } = view
          dispatch(state.tr.replaceSelectionWith(imageNode).scrollIntoView())
          view.focus()
        }
        reader.readAsDataURL(file)
      }
      input.click()
    }
  }
]

export const slashMenuPluginKey = new PluginKey('slashMenu')

export interface SlashMenuState {
  active: boolean
  query: string
  items: SlashMenuItem[]
  selectedIndex: number
  position: { top: number; left: number } | null
}

export function createSlashMenuPlugin(
  onStateChange: (state: SlashMenuState) => void
) {
  return new Plugin({
    key: slashMenuPluginKey,

    state: {
      init(): SlashMenuState {
        return {
          active: false,
          query: '',
          items: slashMenuItems,
          selectedIndex: 0,
          position: null
        }
      },

      apply(tr, prev): SlashMenuState {
        const meta = tr.getMeta(slashMenuPluginKey)
        if (meta) {
          const newState = { ...prev, ...meta }
          onStateChange(newState)
          return newState
        }

        // Check if we should close the menu
        if (prev.active) {
          const { selection } = tr
          const { $from } = selection
          const textBefore = $from.parent.textContent.slice(0, $from.parentOffset)

          // Check if we still have a slash
          const slashIndex = textBefore.lastIndexOf('/')
          if (slashIndex === -1) {
            const newState = { ...prev, active: false, query: '', selectedIndex: 0, position: null }
            onStateChange(newState)
            return newState
          }

          // Update query
          const query = textBefore.slice(slashIndex + 1)
          const filteredItems = slashMenuItems.filter(
            item =>
              item.label.toLowerCase().includes(query.toLowerCase()) ||
              item.description.toLowerCase().includes(query.toLowerCase())
          )

          const newState = {
            ...prev,
            query,
            items: filteredItems,
            selectedIndex: Math.min(prev.selectedIndex, Math.max(0, filteredItems.length - 1))
          }
          onStateChange(newState)
          return newState
        }

        return prev
      }
    },

    props: {
      handleKeyDown(view, event) {
        const state = slashMenuPluginKey.getState(view.state) as SlashMenuState

        // Open menu on /
        if (event.key === '/' && !state.active) {
          const { selection } = view.state
          const { $from } = selection

          // Only open if at start of line or after whitespace
          const textBefore = $from.parent.textContent.slice(0, $from.parentOffset)
          if (textBefore === '' || textBefore.endsWith(' ')) {
            // Get cursor position for menu placement
            const coords = view.coordsAtPos(selection.from)

            setTimeout(() => {
              view.dispatch(
                view.state.tr.setMeta(slashMenuPluginKey, {
                  active: true,
                  query: '',
                  items: slashMenuItems,
                  selectedIndex: 0,
                  position: { top: coords.bottom, left: coords.left }
                })
              )
            }, 0)
          }
          return false
        }

        if (!state.active) return false

        // Handle navigation and selection
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          const newIndex = Math.min(state.selectedIndex + 1, state.items.length - 1)
          view.dispatch(view.state.tr.setMeta(slashMenuPluginKey, { selectedIndex: newIndex }))
          return true
        }

        if (event.key === 'ArrowUp') {
          event.preventDefault()
          const newIndex = Math.max(state.selectedIndex - 1, 0)
          view.dispatch(view.state.tr.setMeta(slashMenuPluginKey, { selectedIndex: newIndex }))
          return true
        }

        if (event.key === 'Enter' && state.items.length > 0) {
          event.preventDefault()
          const item = state.items[state.selectedIndex]

          // Delete the slash and query
          const { $from } = view.state.selection
          const textBefore = $from.parent.textContent.slice(0, $from.parentOffset)
          const slashIndex = textBefore.lastIndexOf('/')
          const from = $from.pos - (textBefore.length - slashIndex)
          const tr = view.state.tr.delete(from, $from.pos)
          view.dispatch(tr.setMeta(slashMenuPluginKey, { active: false, query: '', selectedIndex: 0, position: null }))

          item.action(view)
          return true
        }

        if (event.key === 'Escape') {
          event.preventDefault()
          view.dispatch(
            view.state.tr.setMeta(slashMenuPluginKey, {
              active: false,
              query: '',
              selectedIndex: 0,
              position: null
            })
          )
          return true
        }

        return false
      }
    }
  })
}
