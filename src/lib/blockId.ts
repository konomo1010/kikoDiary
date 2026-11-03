import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'

/** 顶层块类型（与块拖拽手柄的作用域一致） */
export const BLOCK_TYPES = [
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'taskList',
  'codeBlock',
  'image',
  'table',
  'horizontalRule',
]

export function createBlockId(): string {
  return Math.random().toString(36).slice(2, 10)
}

/**
 * 给每个顶层块分配稳定 id，供「Copy anchor link」使用。
 * 没有 id 的新块会在下一次文档变更时自动补上。
 */
export const BlockId = Extension.create({
  name: 'blockId',

  addGlobalAttributes() {
    return [
      {
        types: BLOCK_TYPES,
        attributes: {
          id: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-block-id'),
            renderHTML: (attributes) =>
              attributes.id ? { 'data-block-id': attributes.id } : {},
          },
        },
      },
    ]
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('blockId'),
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((tr) => tr.docChanged)) return null
          const tr: Transaction = newState.tr
          let changed = false
          newState.doc.forEach((node, offset) => {
            if (node.attrs.id) return
            tr.setNodeMarkup(offset, undefined, {
              ...node.attrs,
              id: createBlockId(),
            })
            changed = true
          })
          return changed ? tr : null
        },
      }),
    ]
  },
})
