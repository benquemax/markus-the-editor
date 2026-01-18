import {
  inputRules,
  wrappingInputRule,
  textblockTypeInputRule,
  InputRule
} from 'prosemirror-inputrules'
import { schema } from '../schema'
import { NodeType, MarkType } from 'prosemirror-model'
import { TextSelection } from 'prosemirror-state'

// Heading input rule: # followed by space
function headingRule(nodeType: NodeType, maxLevel: number) {
  return textblockTypeInputRule(
    new RegExp('^(#{1,' + maxLevel + '})\\s$'),
    nodeType,
    (match) => ({ level: match[1].length })
  )
}

// Blockquote input rule: > followed by space
function blockQuoteRule(nodeType: NodeType) {
  return wrappingInputRule(/^\s*>\s$/, nodeType)
}

// Bullet list input rule: - or * followed by space
function bulletListRule(listType: NodeType, itemType: NodeType) {
  return new InputRule(/^\s*([-+*])\s$/, (state, _match, start, end) => {
    const $from = state.selection.$from
    // Only at start of textblock
    if ($from.parentOffset > end - start) return null

    // Get remaining content after the marker
    const textContent = $from.parent.textContent.slice(end - start)

    // Create list item with paragraph containing remaining text
    const paragraph = schema.nodes.paragraph.create(
      null,
      textContent ? schema.text(textContent) : null
    )
    const listItem = itemType.create(null, paragraph)
    const list = listType.create(null, listItem)

    // Replace the entire paragraph with the list
    const $start = state.doc.resolve($from.before($from.depth))
    const $end = state.doc.resolve($from.after($from.depth))

    const tr = state.tr.replaceWith($start.pos, $end.pos, list)
    // Position cursor inside the list item
    tr.setSelection(TextSelection.near(tr.doc.resolve($start.pos + 3)))

    return tr
  })
}

// Ordered list input rule: number followed by . and space
function orderedListRule(listType: NodeType, itemType: NodeType) {
  return new InputRule(/^(\d+)\.\s$/, (state, match, start, end) => {
    const $from = state.selection.$from
    // Only at start of textblock
    if ($from.parentOffset > end - start) return null

    const order = +match[1]

    // Get remaining content after the marker
    const textContent = $from.parent.textContent.slice(end - start)

    // Create list item with paragraph containing remaining text
    const paragraph = schema.nodes.paragraph.create(
      null,
      textContent ? schema.text(textContent) : null
    )
    const listItem = itemType.create(null, paragraph)
    const list = listType.create({ order }, listItem)

    // Replace the entire paragraph with the list
    const $start = state.doc.resolve($from.before($from.depth))
    const $end = state.doc.resolve($from.after($from.depth))

    const tr = state.tr.replaceWith($start.pos, $end.pos, list)
    // Position cursor inside the list item
    tr.setSelection(TextSelection.near(tr.doc.resolve($start.pos + 3)))

    return tr
  })
}

// Code block input rule: ``` followed by optional language
function codeBlockRule(nodeType: NodeType) {
  return textblockTypeInputRule(
    /^```([a-z]*)\s$/,
    nodeType,
    (match) => ({ language: match[1] || '' })
  )
}

// Horizontal rule: ---
function horizontalRuleRule(nodeType: NodeType) {
  return new InputRule(/^(?:---|\*\*\*|___)$/, (state, _match, start, end) => {
    const { tr } = state
    tr.replaceWith(start - 1, end, nodeType.create())
    return tr
  })
}

// Mark input rules for inline formatting
function markInputRule(regexp: RegExp, markType: MarkType) {
  return new InputRule(regexp, (state, match, start, end) => {
    const { tr } = state
    const textContent = match[1]

    if (textContent) {
      const mark = markType.create()
      tr.replaceWith(start, end, schema.text(textContent, [mark]))
    }

    return tr
  })
}

// Bold: **text** or __text__
function strongRule(markType: MarkType) {
  return markInputRule(/(?:\*\*|__)([^*_]+)(?:\*\*|__)$/, markType)
}

// Italic: *text* or _text_
function emRule(markType: MarkType) {
  return markInputRule(/(?:^|[^*_])(?:\*|_)([^*_]+)(?:\*|_)$/, markType)
}

// Inline code: `text`
function codeRule(markType: MarkType) {
  return markInputRule(/`([^`]+)`$/, markType)
}

// Strikethrough: ~~text~~
function strikethroughRule(markType: MarkType) {
  return markInputRule(/~~([^~]+)~~$/, markType)
}

export function buildInputRules() {
  return inputRules({
    rules: [
      // Block rules
      headingRule(schema.nodes.heading, 6),
      blockQuoteRule(schema.nodes.blockquote),
      bulletListRule(schema.nodes.bullet_list, schema.nodes.list_item),
      orderedListRule(schema.nodes.ordered_list, schema.nodes.list_item),
      codeBlockRule(schema.nodes.code_block),
      horizontalRuleRule(schema.nodes.horizontal_rule),

      // Mark rules
      strongRule(schema.marks.strong),
      emRule(schema.marks.em),
      codeRule(schema.marks.code),
      strikethroughRule(schema.marks.strikethrough)
    ]
  })
}
