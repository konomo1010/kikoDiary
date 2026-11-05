import { mergeAttributes } from '@tiptap/core'
import { TaskItem as BaseTaskItem } from '@tiptap/extension-list'
import { Plugin } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

function findTaskItemPos(view: EditorView, input: HTMLInputElement): number {
  const item = input.closest('li')
  if (!item) return -1

  try {
    const start = view.posAtDOM(item, 0)
    const $start = view.state.doc.resolve(start)
    for (let depth = $start.depth; depth > 0; depth--) {
      if ($start.node(depth).type.name === 'taskItem') {
        return $start.before(depth)
      }
    }
    if (view.state.doc.nodeAt(start)?.type.name === 'taskItem') return start
  } catch {
    return -1
  }
  return -1
}

/**
 * TaskItem without Tiptap's custom NodeView. The NodeView rewrites sibling
 * checkbox/label DOM during every composition update, which makes Chrome's
 * Chinese IME caret stay before the text in task lists. Static rendering keeps
 * the task-item DOM stable while typing; checkbox clicks are handled by the
 * small plugin below.
 */
export const TaskItem = BaseTaskItem.extend({
  addNodeView() {
    return null
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'li',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-type': this.name,
        'data-checked': node.attrs.checked ? 'true' : 'false',
      }),
      [
        'label',
        { contenteditable: 'false' },
        [
          'input',
          {
            type: 'checkbox',
            checked: node.attrs.checked ? 'checked' : null,
            'aria-label': '任务完成状态',
          },
        ],
      ],
      ['div', 0],
    ]
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            mousedown: (_view, event) => {
              const target = event.target
              if (target instanceof HTMLInputElement && target.type === 'checkbox') {
                // Keep the text selection in the task item while toggling.
                event.preventDefault()
              }
              return false
            },
            click: (view, event) => {
              const target = event.target
              if (
                !(target instanceof HTMLInputElement) ||
                target.type !== 'checkbox' ||
                !view.editable
              ) {
                return false
              }

              const pos = findTaskItemPos(view, target)
              if (pos < 0) return false
              const node = view.state.doc.nodeAt(pos)
              if (!node) return false

              const checked = !node.attrs.checked
              target.checked = checked
              view.dispatch(
                view.state.tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  checked,
                })
              )
              event.preventDefault()
              return true
            },
          },
        },
      }),
    ]
  },
})
