import { Extension } from '@tiptap/core'
import {
  copyBlockAnchor,
  copyBlockText,
  deleteBlockAt,
  duplicateBlock,
  selectedBlockPos,
} from './blockActions'

/**
 * 块级快捷键。只在选中了整块（NodeSelection / NodeRangeSelection）时接管，
 * 普通文本编辑下的 Ctrl+C / Backspace 完全不受影响。
 */
export const BlockShortcuts = Extension.create({
  name: 'blockShortcuts',

  addKeyboardShortcuts() {
    const editor = this.editor

    const runOnSelectedBlock = (action: (pos: number) => void): boolean => {
      const pos = selectedBlockPos(editor)
      if (pos == null) return false
      action(pos)
      return true
    }

    return {
      'Mod-d': () =>
        runOnSelectedBlock((pos) => {
          duplicateBlock(editor, pos)
        }),

      'Mod-c': () =>
        runOnSelectedBlock((pos) => {
          void copyBlockText(editor, pos)
        }),

      // 参考实现用 mod+ctrl+l；Windows 上 mod 即 ctrl，因此再补一个 Mod-l
      'Mod-Ctrl-l': () =>
        runOnSelectedBlock((pos) => {
          void copyBlockAnchor(editor, pos)
        }),
      'Mod-l': () =>
        runOnSelectedBlock((pos) => {
          void copyBlockAnchor(editor, pos)
        }),

      Backspace: () =>
        runOnSelectedBlock((pos) => {
          deleteBlockAt(editor, pos)
        }),
    }
  },
})
