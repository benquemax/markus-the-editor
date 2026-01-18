import { keymap } from 'prosemirror-keymap'
import { baseKeymap, toggleMark, setBlockType, wrapIn, chainCommands, liftEmptyBlock, splitBlock } from 'prosemirror-commands'
import { undo, redo } from 'prosemirror-history'
import { schema } from '../schema'
import { EditorState, Transaction } from 'prosemirror-state'
import { splitListItem, liftListItem, sinkListItem } from 'prosemirror-schema-list'

type Command = (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean

// Toggle heading at a specific level
function toggleHeading(level: number): Command {
  return (state, dispatch) => {
    const { $from } = state.selection
    const nodeType = schema.nodes.heading

    // If we're already in a heading of this level, convert to paragraph
    if ($from.parent.type === nodeType && $from.parent.attrs.level === level) {
      return setBlockType(schema.nodes.paragraph)(state, dispatch)
    }

    return setBlockType(nodeType, { level })(state, dispatch)
  }
}

// Custom save command that will be handled by the editor
function saveCommand(onSave?: () => void): Command {
  return (_state, _dispatch) => {
    if (onSave) {
      onSave()
      return true
    }
    return false
  }
}

export function buildKeymap(onSave?: () => void) {
  const keys: { [key: string]: Command } = {}

  // Basic editing
  keys['Mod-z'] = undo
  keys['Mod-y'] = redo
  keys['Mod-Shift-z'] = redo

  // Save
  keys['Mod-s'] = saveCommand(onSave)

  // Formatting
  keys['Mod-b'] = toggleMark(schema.marks.strong)
  keys['Mod-i'] = toggleMark(schema.marks.em)
  keys['Mod-`'] = toggleMark(schema.marks.code)
  keys['Mod-Shift-x'] = toggleMark(schema.marks.strikethrough)

  // Headings
  keys['Mod-Alt-1'] = toggleHeading(1)
  keys['Mod-Alt-2'] = toggleHeading(2)
  keys['Mod-Alt-3'] = toggleHeading(3)
  keys['Mod-Alt-4'] = toggleHeading(4)
  keys['Mod-Alt-5'] = toggleHeading(5)
  keys['Mod-Alt-6'] = toggleHeading(6)

  // Block formatting
  keys['Mod-Alt-0'] = setBlockType(schema.nodes.paragraph)
  keys['Mod-Shift-c'] = setBlockType(schema.nodes.code_block)
  keys['Mod-Shift->'] = wrapIn(schema.nodes.blockquote)

  // List handling - chain commands so Enter works in lists AND regular blocks
  keys['Enter'] = chainCommands(
    splitListItem(schema.nodes.list_item),
    liftEmptyBlock,
    splitBlock
  )
  keys['Tab'] = sinkListItem(schema.nodes.list_item)
  keys['Shift-Tab'] = liftListItem(schema.nodes.list_item)

  return keymap({ ...baseKeymap, ...keys })
}

export function buildBaseKeymap() {
  return keymap(baseKeymap)
}
