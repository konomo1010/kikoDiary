import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const searchHighlightKey = new PluginKey('kikoSearchHighlight')
let keyword = ''

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildDecorations(doc) {
  if (!keyword) return DecorationSet.empty
  const pattern = new RegExp(escapeRegExp(keyword), 'gi')
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    if (node.type.name === 'codeBlock') return
    if (node.marks?.some((m) => m.type.name === 'link')) return
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(node.text)) !== null) {
      decorations.push(
        Decoration.inline(pos + match.index, pos + match.index + match[0].length, {
          class: 'kiko-search-highlight',
        }),
      )
      if (match[0].length === 0) pattern.lastIndex++
    }
  })
  return DecorationSet.create(doc, decorations)
}

const searchHighlightPlugin = new Plugin({
  key: searchHighlightKey,
  state: {
    init: (_config, state) => buildDecorations(state.doc),
    apply: (tr, old, _oldState, newState) => {
      const meta = tr.getMeta(searchHighlightKey)
      if (meta && typeof meta.keyword === 'string') {
        keyword = meta.keyword
        return buildDecorations(newState.doc)
      }
      if (tr.docChanged) return buildDecorations(newState.doc)
      return old
    },
  },
  props: {
    decorations(state) {
      return searchHighlightKey.getState(state)
    },
  },
})

export const SearchHighlight = Extension.create({
  name: 'kikoSearchHighlight',
  addProseMirrorPlugins() {
    return [searchHighlightPlugin]
  },
})

export function setSearchKeyword(editor, kw: string) {
  if (!editor) return
  editor.view.dispatch(editor.state.tr.setMeta(searchHighlightKey, { keyword: kw || '' }))
}
