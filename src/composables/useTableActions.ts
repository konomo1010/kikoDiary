import type { Editor } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  CellSelection,
  columnIsHeader,
  deleteColumn,
  deleteRow,
  mergeCells,
  moveTableColumn,
  moveTableRow,
  removeColumn,
  removeRow,
  rowIsHeader,
  selectedRect,
  splitCell,
  toggleHeader,
  TableMap,
} from '@tiptap/pm/tables'
import {
  countEmptyColumnsFromEnd,
  countEmptyRowsFromEnd,
  EMPTY_CELL_HEIGHT,
  EMPTY_CELL_WIDTH,
  getIndexCoordinates,
  getColumnCells,
  getRowOrColumnCells,
  getTable,
  getTableSelectionType,
  isCellEmpty,
  isCellMerged,
  marginRound,
  RESIZE_MIN_WIDTH,
  selectCellsByCoords,
  selectLastCell,
  updateSelectionAfterAction,
  type Orientation,
} from '../lib/table/tableUtils'

export type MoveDirection = 'up' | 'down' | 'left' | 'right'
export type RowSide = 'above' | 'below'
export type ColSide = 'left' | 'right'
export type TextAlignment = 'left' | 'center' | 'right' | 'justify'
export type VerticalAlignment = 'top' | 'middle' | 'bottom'

const dispatch = (editor: Editor) => (tr: Transaction) => editor.view.dispatch(tr)

function ensureCellState(editor: Editor, tablePos: number, index: number, orientation: Orientation): EditorState | null {
  const coords = getIndexCoordinates({ editor, index, orientation, tablePos })
  if (!coords) return null
  const result = selectCellsByCoords(editor, tablePos, coords, { mode: 'state' })
  return result && typeof result !== 'boolean' ? result : null
}

export function canAddRowColumn(
  editor: Editor | null,
  index: number,
  orientation: Orientation,
  side: RowSide | ColSide,
  tablePos: number,
): boolean {
  if (!editor?.isEditable) return false
  const table = getTable(editor, tablePos)
  if (!table) return false
  if (orientation === 'column' && index >= table.map.width) return false
  if (orientation === 'row' && index >= table.map.height) return false
  if (side === 'left' && orientation === 'column' && columnIsHeader(table.map, table.node, index)) return false
  if (side === 'above' && orientation === 'row' && rowIsHeader(table.map, table.node, index)) return false
  return true
}

export function addRowColumn(
  editor: Editor,
  index: number,
  orientation: Orientation,
  side: RowSide | ColSide,
  tablePos: number,
): boolean {
  if (!canAddRowColumn(editor, index, orientation, side, tablePos)) return false
  const isRow = orientation === 'row'
  const operation = isRow ? (side === 'above' ? addRowBefore : addRowAfter) : (side === 'left' ? addColumnBefore : addColumnAfter)
  const state = ensureCellState(editor, tablePos, index, orientation)
  if (!state) return false
  const success = operation(state, dispatch(editor))
  if (success) {
    const newIndex = side === 'above' || side === 'left' ? index : index + 1
    updateSelectionAfterAction(editor, orientation, newIndex, tablePos)
  }
  return success
}

export function addRowColumnAfter(
  editor: Editor,
  index: number,
  orientation: Orientation,
  tablePos: number,
): boolean {
  return addRowColumn(editor, index, orientation, orientation === 'row' ? 'below' : 'right', tablePos)
}

export function deleteRowColumn(
  editor: Editor,
  index: number,
  orientation: Orientation,
  tablePos: number,
): boolean {
  const table = getTable(editor, tablePos)
  if (!table) return false
  const state = ensureCellState(editor, tablePos, index, orientation)
  if (!state) return false
  return (orientation === 'row' ? deleteRow : deleteColumn)(state, dispatch(editor))
}

export function toggleHeaderRowColumn(
  editor: Editor,
  index: number,
  orientation: Orientation,
  tablePos: number,
): boolean {
  if (index !== 0) return false
  const state = ensureCellState(editor, tablePos, index, orientation)
  if (!state) return false
  return toggleHeader(orientation === 'row' ? 'row' : 'column')(state, dispatch(editor))
}

export function isHeaderActive(editor: Editor, index: number, orientation: Orientation, tablePos: number): boolean {
  const cells = getRowOrColumnCells(editor, index, orientation, tablePos).cells
  if (!cells.length) return false
  return cells.every((c) => c.node.type.name === 'tableHeader')
}

export function moveRowColumn(
  editor: Editor,
  index: number,
  orientation: Orientation,
  direction: MoveDirection,
  tablePos: number,
): boolean {
  const table = getTable(editor, tablePos)
  if (!table) return false
  const max = orientation === 'row' ? table.map.height : table.map.width
  const delta = direction === 'up' || direction === 'left' ? -1 : 1
  const to = index + delta
  if (to < 0 || to >= max) return false
  return moveRowColumnTo(editor, index, orientation, to, tablePos)
}

export function moveRowColumnTo(
  editor: Editor,
  index: number,
  orientation: Orientation,
  to: number,
  tablePos: number,
): boolean {
  const table = getTable(editor, tablePos)
  if (!table) return false
  const max = orientation === 'row' ? table.map.height : table.map.width
  if (index < 0 || index >= max || to < 0 || to >= max) return false

  const source = ensureCellState(editor, tablePos, index, orientation)
  if (!source) return false
  return (orientation === 'row' ? moveTableRow : moveTableColumn)(
    { from: index, to, select: true, pos: table.start },
  )(source, dispatch(editor))
}

export function createTableDragImage(
  editor: Editor,
  orientation: Orientation,
  index: number,
  tablePos: number,
): HTMLElement | null {
  const cells = getRowOrColumnCells(editor, index, orientation, tablePos).cells
  if (!cells.length) return null

  const wrapper = document.createElement('div')
  wrapper.style.position = 'fixed'
  wrapper.style.left = '-10000px'
  wrapper.style.top = '-10000px'
  wrapper.style.zIndex = '2147483647'
  wrapper.style.pointerEvents = 'none'
  wrapper.style.background = 'rgba(255,255,255,0.92)'
  wrapper.style.borderRadius = '12px'
  wrapper.style.boxShadow = '0 16px 48px rgba(17,24,39,0.2)'
  wrapper.style.display = orientation === 'row' ? 'flex' : 'flex'
  wrapper.style.flexDirection = orientation === 'row' ? 'row' : 'column'

  cells.forEach((cell) => {
    const dom = editor.view.nodeDOM(cell.pos) as HTMLElement | null
    if (dom) wrapper.appendChild(dom.cloneNode(true))
  })
  document.body.appendChild(wrapper)
  return wrapper
}

export function duplicateRowColumn(
  editor: Editor,
  index: number,
  orientation: Orientation,
  tablePos: number,
): boolean {
  const original = getRowOrColumnCells(editor, index, orientation, tablePos)
  if (!original.cells.length || original.mergedCells.length) return false
  if (!addRowColumn(editor, index, orientation, orientation === 'row' ? 'below' : 'right', tablePos)) return false

  const copy = getRowOrColumnCells(editor, index + 1, orientation, tablePos)
  const tr = editor.state.tr
  const copyCells = [...copy.cells].reverse()
  const originalCells = [...original.cells].reverse()

  copyCells.forEach((cell, i) => {
    const src = originalCells[i]
    if (cell.node && src?.node) {
      const dup = cell.node.type.create({ ...src.node.attrs }, src.node.content, src.node.marks)
      tr.replaceWith(cell.pos, cell.pos + cell.node.nodeSize, dup)
    }
  })

  if (tr.docChanged) {
    editor.view.dispatch(tr)
    updateSelectionAfterAction(editor, orientation, index + 1, tablePos)
    return true
  }
  return false
}

function cellSortText(cell: Node | null): string {
  if (!cell) return ''
  let text = ''
  cell.descendants((node) => {
    if (node.isText) text += node.text || ''
    return true
  })
  return text.trim().toLowerCase()
}

function isHeaderCell(cell: Node | null): boolean {
  return cell?.type.name === 'tableHeader'
}

export function sortRowColumn(
  editor: Editor,
  index: number,
  orientation: Orientation,
  direction: 'asc' | 'desc',
  tablePos: number,
): boolean {
  const data = getRowOrColumnCells(editor, index, orientation, tablePos)
  if (data.mergedCells.length || data.cells.length < 2) return false

  const items = data.cells.map((info, originalIndex) => ({
    info,
    originalIndex,
    isHeader: isHeaderCell(info.node),
    isEmpty: info.node ? isCellEmpty(info.node) : true,
    text: cellSortText(info.node),
  }))

  const dataItems = items.filter((i) => !i.isHeader)
  if (dataItems.length < 2) return false

  dataItems.sort((a, b) => {
    if (a.isEmpty && !b.isEmpty) return 1
    if (!a.isEmpty && b.isEmpty) return -1
    if (a.isEmpty && b.isEmpty) return 0
    const cmp = a.text.localeCompare(b.text, undefined, { sensitivity: 'base' })
    return direction === 'asc' ? cmp : -cmp
  })

  const newNodes: (Node | null)[] = []
  let dataIndex = 0
  for (const item of items) {
    if (item.isHeader) newNodes.push(item.info.node)
    else newNodes.push(dataItems[dataIndex++]?.info.node ?? null)
  }

  const tr = editor.state.tr
  const reversed = [...data.cells].reverse()
  const reversedNodes = [...newNodes].reverse()
  reversed.forEach((cell, i) => {
    const node = reversedNodes[i]
    if (cell.node && node) {
      const next = cell.node.type.create(node.attrs, node.content, node.marks)
      tr.replaceWith(cell.pos, cell.pos + cell.node.nodeSize, next)
    }
  })

  if (tr.docChanged) {
    editor.view.dispatch(tr)
    return true
  }
  return false
}

export function clearRowColumnContent(
  editor: Editor,
  index: number,
  orientation: Orientation,
  tablePos: number,
): boolean {
  const data = getRowOrColumnCells(editor, index, orientation, tablePos)
  const tr = editor.state.tr
  const unique = Array.from(new Map(data.cells.map((c) => [c.pos, c])).values()).sort((a, b) => b.pos - a.pos)

  unique.forEach((cell) => {
    if (cell.node && !isCellEmpty(cell.node)) {
      const from = cell.pos + 1
      const to = cell.pos + cell.node.nodeSize - 1
      if (from < to) tr.delete(from, to)
      tr.setNodeMarkup(cell.pos, null, {
        ...cell.node.attrs,
        textAlign: null,
        verticalAlign: null,
        align: null,
      })
    }
  })

  if (tr.docChanged) {
    editor.view.dispatch(tr)
    return true
  }
  return false
}

export function clearSelectedCells(editor: Editor): boolean {
  const { selection } = editor.state
  const tr = editor.state.tr
  if (selection instanceof CellSelection) {
    selection.forEachCell((node, pos) => {
      if (node && !isCellEmpty(node)) {
        tr.delete(pos + 1, pos + node.nodeSize - 1)
        tr.setNodeMarkup(pos, null, { ...node.attrs, textAlign: null, verticalAlign: null, align: null })
      }
    })
    if (tr.docChanged) {
      editor.view.dispatch(tr)
      return true
    }
    return false
  }
  return false
}

export function alignRowColumn(
  editor: Editor,
  index: number,
  orientation: Orientation,
  tablePos: number,
  type: 'text' | 'vertical',
  value: string,
): boolean {
  const data = getRowOrColumnCells(editor, index, orientation, tablePos)
  const tr = editor.state.tr
  const unique = Array.from(new Map(data.cells.map((c) => [c.pos, c])).values())
  unique.forEach((cell) => {
    if (cell.node) {
      const attrs = type === 'text' ? { textAlign: value, align: null } : { verticalAlign: value }
      tr.setNodeMarkup(cell.pos, null, { ...cell.node.attrs, ...attrs })
    }
  })
  if (tr.docChanged) {
    editor.view.dispatch(tr)
    return true
  }
  return false
}

export function setColumnWidth(
  editor: Editor,
  tablePos: number,
  colIndex: number,
  width: number,
): boolean {
  const column = getColumnCells(editor, colIndex, tablePos)
  if (!column.cells.length) return false
  const value = Math.max(35, Math.round(width))
  const tr = editor.state.tr
  for (const cell of column.cells) {
    if (!cell.node) continue
    tr.setNodeMarkup(cell.pos, null, { ...cell.node.attrs, colwidth: [value] })
  }
  if (tr.docChanged) {
    editor.view.dispatch(tr)
    return true
  }
  return false
}

export function setRowHeight(
  editor: Editor,
  tablePos: number,
  rowIndex: number,
  height: number | null,
): boolean {
  const table = getTable(editor, tablePos)
  if (!table) return false
  if (rowIndex < 0 || rowIndex >= table.node.childCount) return false

  let rowPos = tablePos + 1
  for (let i = 0; i < rowIndex; i++) rowPos += table.node.child(i).nodeSize
  const row = table.node.child(rowIndex)

  const tr = editor.state.tr.setNodeMarkup(rowPos, null, {
    ...row.attrs,
    rowHeight: height == null ? null : Math.max(30, Math.round(height)),
  })
  editor.view.dispatch(tr)
  return true
}

export function setCellBackground(editor: Editor, color: string | null): boolean {
  const { selection } = editor.state
  const tr = editor.state.tr
  const apply = (pos: number, node: Node) => {
    tr.setNodeMarkup(pos, null, { ...node.attrs, backgroundColor: color })
  }

  if (selection instanceof CellSelection) {
    selection.forEachCell((node, pos) => apply(pos, node))
  } else {
    const $from = selection.$from
    for (let depth = $from.depth; depth > 0; depth--) {
      const node = $from.node(depth)
      if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
        apply($from.before(depth), node)
        break
      }
    }
  }

  if (tr.docChanged) {
    editor.view.dispatch(tr)
    return true
  }
  return false
}

export function alignSelectedCells(editor: Editor, type: 'text' | 'vertical', value: string): boolean {
  const { selection } = editor.state
  const tr = editor.state.tr
  const attrs = type === 'text' ? { textAlign: value, align: null } : { verticalAlign: value }

  if (selection instanceof CellSelection) {
    selection.forEachCell((node, pos) => {
      tr.setNodeMarkup(pos, null, { ...node.attrs, ...attrs })
    })
  } else {
    // 单击单元格时是普通 TextSelection，也要能修改当前单元格对齐。
    const $from = selection.$from
    for (let depth = $from.depth; depth > 0; depth--) {
      const node = $from.node(depth)
      if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
        tr.setNodeMarkup($from.before(depth), null, { ...node.attrs, ...attrs })
        break
      }
    }
  }

  if (tr.docChanged) {
    editor.view.dispatch(tr)
    return true
  }
  return false
}

export function fitTableToWidth(editor: Editor): boolean {
  const table = getTable(editor)
  if (!table) return false
  const editorElement = editor.view.dom as HTMLElement
  const style = getComputedStyle(editorElement)
  const paddingLeft = parseFloat(style.paddingLeft) || 0
  const paddingRight = parseFloat(style.paddingRight) || 0
  const editorWidth = editorElement.clientWidth - paddingLeft - paddingRight
  const columnCount = table.map.width
  if (columnCount === 0) return false

  const availableWidth = editorWidth - columnCount - 8
  const colWidth = Math.max(Math.floor(availableWidth / columnCount), RESIZE_MIN_WIDTH)

  const tr = editor.state.tr
  table.node.descendants((child, childPos) => {
    if (child.type.name === 'tableCell' || child.type.name === 'tableHeader') {
      const colspan = child.attrs.colspan || 1
      tr.setNodeMarkup(table.start + childPos, undefined, {
        ...child.attrs,
        colwidth: Array(colspan).fill(colWidth),
      })
    }
  })
  if (tr.docChanged) editor.view.dispatch(tr)
  return true
}

export function removeLastRow(editor: Editor, tablePos: number): void {
  const table = getTable(editor, tablePos)
  if (!table) return
  selectLastCell(editor, table.node, tablePos, 'row')
  const rect = selectedRect(editor.state)
  const tr = editor.state.tr
  removeRow(tr, rect, rect.map.height - 1)
  editor.view.dispatch(tr)
}

export function removeLastColumn(editor: Editor, tablePos: number): void {
  const table = getTable(editor, tablePos)
  if (!table) return
  selectLastCell(editor, table.node, tablePos, 'column')
  const rect = selectedRect(editor.state)
  const tr = editor.state.tr
  removeColumn(tr, rect, rect.map.width - 1)
  editor.view.dispatch(tr)
}

export function extendRows(
  editor: Editor,
  tableNode: Node,
  tablePos: number,
  diff: number,
): void {
  if (diff > 0) {
    for (let i = 0; i < diff; i++) {
      selectLastCell(editor, tableNode, tablePos, 'row')
      editor.chain().focus().addRowAfter().run()
    }
  } else {
    const abs = Math.abs(diff)
    const empty = countEmptyRowsFromEnd(editor, tablePos)
    const current = TableMap.get(tableNode).height
    const safe = Math.min(abs, empty, current - 1)
    for (let i = 0; i < safe; i++) removeLastRow(editor, tablePos)
  }
}

export function extendColumns(
  editor: Editor,
  tableNode: Node,
  tablePos: number,
  diff: number,
): void {
  if (diff > 0) {
    for (let i = 0; i < diff; i++) {
      selectLastCell(editor, tableNode, tablePos, 'column')
      editor.chain().focus().addColumnAfter().run()
    }
  } else {
    const abs = Math.abs(diff)
    const empty = countEmptyColumnsFromEnd(editor, tablePos)
    const current = TableMap.get(tableNode).width
    const safe = Math.min(abs, empty, current - 1)
    for (let i = 0; i < safe; i++) removeLastColumn(editor, tablePos)
  }
}

export const extendCellSize = { EMPTY_CELL_HEIGHT, EMPTY_CELL_WIDTH, marginRound }
