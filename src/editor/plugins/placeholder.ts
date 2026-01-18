import { Plugin } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

export function createPlaceholderPlugin(placeholderText: string = 'Start typing or press / for commands...') {
  return new Plugin({
    props: {
      decorations(state) {
        const doc = state.doc

        // Only show placeholder if document is empty
        if (doc.childCount === 1 && doc.firstChild?.isTextblock && doc.firstChild.content.size === 0) {
          const placeholder = document.createElement('span')
          placeholder.className = 'placeholder'
          placeholder.textContent = placeholderText

          return DecorationSet.create(doc, [
            Decoration.widget(1, placeholder, { side: 0 })
          ])
        }

        return DecorationSet.empty
      }
    }
  })
}
