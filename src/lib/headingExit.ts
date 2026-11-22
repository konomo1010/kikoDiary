import { Extension } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

/**
 * 空标题（H1/H2/H3）上按退格 / 删除键时，默认会被 ProseMirror 当成「删除空文本块」，
 * 整行标题直接消失。这里改为「退出标题」：把空 heading 降级为空段落，光标留在原地。
 */
export const HeadingExit = Extension.create({
  name: 'headingExit',

  addKeyboardShortcuts() {
    const editor = this.editor

    const exitEmptyHeading = (): boolean => {
      const { state, view } = editor
      const { selection } = state
      if (!selection.empty) return false

      const { $from } = selection
      const parent = $from.parent

      // 只在「光标所在块是空的 heading」时接管
      if (parent.type.name !== 'heading') return false
      if (parent.content.size > 0) return false

      const pos = $from.before($from.depth)
      const tr = state.tr.setNodeMarkup(pos, editor.schema.nodes.paragraph, {
        ...parent.attrs,
      })
      tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)))
      view.dispatch(tr)
      view.focus()
      return true
    }

    return {
      Backspace: exitEmptyHeading,
      Delete: exitEmptyHeading,
    }
  },
})
