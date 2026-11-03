import type { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { NodeRangeSelection, isNodeRangeSelection } from '@tiptap/extension-node-range'

export type TurnIntoValue =
  | 'paragraph'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'blockquote'
  | 'codeBlock'

export function blockAt(editor: Editor | null, pos: number) {
  if (!editor || pos < 0) return null
  return editor.state.doc.nodeAt(pos)
}

/** 当前选区是否覆盖了一个完整块（NodeSelection 或 NodeRangeSelection） */
export function selectedBlockPos(editor: Editor | null): number | null {
  if (!editor) return null
  const sel = editor.state.selection
  if (sel instanceof NodeSelection) return sel.from
  if (isNodeRangeSelection(sel)) return sel.from
  return null
}

/** 选中某个顶层块，让键盘快捷键有作用对象 */
export function selectBlock(editor: Editor | null, pos: number): boolean {
  if (!editor) return false
  const node = blockAt(editor, pos)
  if (!node) return false
  const selection = NodeSelection.isSelectable(node)
    ? NodeSelection.create(editor.state.doc, pos)
    : NodeRangeSelection.create(editor.state.doc, pos, pos + node.nodeSize)
  editor.view.dispatch(editor.state.tr.setSelection(selection))
  return true
}

export function turnBlockInto(
  editor: Editor | null,
  pos: number,
  value: TurnIntoValue
): boolean {
  if (!editor || pos < 0) return false
  const c = editor.chain().focus().setTextSelection(pos + 1)
  switch (value) {
    case 'paragraph':
      c.setParagraph().run()
      break
    case 'h1':
      c.setHeading({ level: 1 }).run()
      break
    case 'h2':
      c.setHeading({ level: 2 }).run()
      break
    case 'h3':
      c.setHeading({ level: 3 }).run()
      break
    case 'bulletList':
      c.toggleBulletList().run()
      break
    case 'orderedList':
      c.toggleOrderedList().run()
      break
    case 'taskList':
      c.toggleTaskList().run()
      break
    case 'blockquote':
      c.toggleBlockquote().run()
      break
    case 'codeBlock':
      c.toggleCodeBlock().run()
      break
  }
  return true
}

export function duplicateBlock(editor: Editor | null, pos: number): boolean {
  const node = blockAt(editor, pos)
  if (!editor || !node) return false
  editor.chain().focus().insertContentAt(pos + node.nodeSize, node.toJSON()).run()
  return true
}

export async function copyBlockText(
  editor: Editor | null,
  pos: number
): Promise<boolean> {
  const node = blockAt(editor, pos)
  if (!node) return false
  try {
    await navigator.clipboard.writeText(node.textContent)
    return true
  } catch {
    return false
  }
}

export function blockAnchorId(editor: Editor | null, pos: number): string | null {
  const node = blockAt(editor, pos)
  const id = node?.attrs?.id
  return typeof id === 'string' && id.length > 0 ? id : null
}

export async function copyBlockAnchor(
  editor: Editor | null,
  pos: number
): Promise<boolean> {
  const id = blockAnchorId(editor, pos)
  if (!id) return false
  const base = window.location.href.split('#')[0]
  try {
    await navigator.clipboard.writeText(`${base}#${id}`)
    return true
  } catch {
    return false
  }
}

export function deleteBlockAt(editor: Editor | null, pos: number): boolean {
  const node = blockAt(editor, pos)
  if (!editor || !node) return false
  editor
    .chain()
    .focus()
    .deleteRange({ from: pos, to: pos + node.nodeSize })
    .run()
  return true
}

export function setBlockColor(
  editor: Editor | null,
  pos: number,
  color: string | null
): boolean {
  const node = blockAt(editor, pos)
  if (!editor || !node) return false
  const from = pos + 1
  const to = Math.max(from, pos + node.nodeSize - 1)
  const c = editor.chain().focus().setTextSelection({ from, to })
  if (!color) c.unsetColor().run()
  else c.setColor(color).run()
  return true
}

export function setBlockHighlight(
  editor: Editor | null,
  pos: number,
  color: string | null
): boolean {
  const node = blockAt(editor, pos)
  if (!editor || !node) return false
  const from = pos + 1
  const to = Math.max(from, pos + node.nodeSize - 1)
  const c = editor.chain().focus().setTextSelection({ from, to })
  if (!color) c.unsetHighlight().run()
  else c.setHighlight({ color }).run()
  return true
}
