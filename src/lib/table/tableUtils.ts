import type { Editor } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { Selection } from '@tiptap/pm/state'
import {
  CellSelection,
  TableMap,
  findTable,
  selectedRect,
  cellAround,
  selectionCell,
  isInTable,
  findCellPos,
  type Rect,
} from '@tiptap/pm/tables'
import { Mapping } from '@tiptap/pm/transform'

export const RESIZE_MIN_WIDTH = 35
export const EMPTY_CELL_WIDTH = 120
export const EMPTY_CELL_HEIGHT = 40

export type Orientation = 'row' | 'column'
export type CellCoordinates = { row: number; col: number }
export type SelectionReturnMode = 'state' | 'transaction' | 'dispatch'

export interface CellInfo {
  pos: number
  node: Node
  row: number
  column: number
  start: number
  depth: number
}

export interface TableInfo {
  map: TableMap
  node: Node
  pos: number
  start: number
  depth: number
}

const EMPTY_CELLS_RESULT = { cells: [], mergedCells: [] }

export function isHTMLElement(n: unknown): n is HTMLElement {
  return typeof HTMLElement !== 'undefined' && n instanceof HTMLElement
}

export type DomCellAroundResult =
  | { type: 'cell'; domNode: HTMLElement; tbodyNode: HTMLTableSectionElement | null }
  | { type: 'wrapper'; domNode: HTMLElement; tbodyNode: HTMLTableSectionElement | null }

export function safeClosest<T extends Element>(start: Element | null, selector: string): T | null {
  return (start?.closest?.(selector) as T | null) ?? null
}

export function domCellAround(target: Element): DomCellAroundResult | undefined {
  let current: Element | null = target
  while (
    current &&
    current.tagName !== 'TD' &&
    current.tagName !== 'TH' &&
    !current.classList.contains('tableWrapper')
  ) {
    if (current.classList.contains('ProseMirror')) return undefined
    current = current.parentElement
  }
  if (!current) return undefined
  if (current.tagName === 'TD' || current.tagName === 'TH') {
    return {
      type: 'cell',
      domNode: current as HTMLElement,
      tbodyNode: safeClosest<HTMLTableSectionElement>(current, 'tbody'),
    }
  }
  return {
    type: 'wrapper',
    domNode: current as HTMLElement,
    tbodyNode: (current as HTMLElement).querySelector('tbody'),
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

function isWithinBounds(row: number, col: number, map: TableMap): boolean {
  return row >= 0 && row < map.height && col >= 0 && col < map.width
}

export function isCellMerged(node: Node | null): boolean {
  if (!node) return false
  const colspan = node.attrs.colspan ?? 1
  const rowspan = node.attrs.rowspan ?? 1
  return colspan > 1 || rowspan > 1
}

export function getTable(editor: Editor | null, tablePos?: number): TableInfo | null {
  if (!editor) return null

  let table: { node: Node; pos: number; start: number; depth: number } | null = null

  if (typeof tablePos === 'number') {
    const tableNode = editor.state.doc.nodeAt(tablePos)
    if (tableNode?.type.name === 'table') {
      table = {
        node: tableNode,
        pos: tablePos,
        start: tablePos + 1,
        depth: editor.state.doc.resolve(tablePos).depth,
      }
    }
  }

  if (typeof tablePos !== 'number') {
    const { state } = editor
    const $from = state.doc.resolve(state.selection.from)
    table = findTable($from)
  }

  if (!table) return null
  const tableMap = TableMap.get(table.node)
  if (!tableMap) return null
  return { ...table, map: tableMap }
}

function resolveOrientationIndex(
  state: EditorState,
  table: TableInfo,
  orientation: Orientation,
  providedIndex?: number,
): number | null {
  if (typeof providedIndex === 'number') return providedIndex

  if (state.selection instanceof CellSelection) {
    const rect = selectedRect(state)
    if (rect.tableStart !== table.start) return null
    return orientation === 'row' ? rect.top : rect.left
  }

  const $cell =
    cellAround(state.selection.$anchor) ?? findCellPos(state.doc, state.selection.head)
  if (!$cell || $cell.start(-1) !== table.start) return null

  const rel = $cell.pos - table.start
  const rect = table.map.findCell(rel)
  return orientation === 'row' ? rect.top : rect.left
}

function createCellInfo(row: number, column: number, cellPos: number, cellNode: Node): CellInfo {
  return {
    row,
    column,
    pos: cellPos,
    node: cellNode,
    start: cellPos + 1,
    depth: cellNode ? cellNode.content.size : 0,
  }
}

function collectCells(
  editor: Editor | null,
  orientation: Orientation,
  index?: number,
  tablePos?: number,
): { cells: CellInfo[]; mergedCells: CellInfo[] } {
  if (!editor) return EMPTY_CELLS_RESULT

  const { state } = editor
  const table = getTable(editor, tablePos)
  if (!table) return EMPTY_CELLS_RESULT

  const tableStart = table.start
  const tableNode = table.node
  const map = table.map

  const resolvedIndex = resolveOrientationIndex(state, table, orientation, index)
  if (resolvedIndex === null) return EMPTY_CELLS_RESULT

  const maxIndex = orientation === 'row' ? map.height : map.width
  if (resolvedIndex < 0 || resolvedIndex >= maxIndex) return EMPTY_CELLS_RESULT

  const cells: CellInfo[] = []
  const mergedCells: CellInfo[] = []
  const seenMerged = new Set<number>()
  const iterationCount = orientation === 'row' ? map.width : map.height

  for (let i = 0; i < iterationCount; i++) {
    const row = orientation === 'row' ? resolvedIndex : i
    const col = orientation === 'row' ? i : resolvedIndex
    const cellIndex = row * map.width + col
    const mapCell = map.map[cellIndex]
    if (mapCell === undefined) continue

    const cellPos = tableStart + mapCell
    const cellNode = tableNode.nodeAt(mapCell)
    if (!cellNode) continue

    const cell = createCellInfo(row, col, cellPos, cellNode)
    if (isCellMerged(cellNode)) {
      if (!seenMerged.has(cellPos)) {
        mergedCells.push(cell)
        seenMerged.add(cellPos)
      }
    }
    cells.push(cell)
  }

  return { cells, mergedCells }
}

function isCellBlank(cellNode: Node): boolean {
  let blank = true
  cellNode.forEach((child) => {
    if (!blank) return
    if (!child.isTextblock || child.type.spec.code) {
      blank = false
      return
    }
    child.forEach((inline) => {
      if (!inline.isText || inline.marks.length > 0 || inline.text?.trim()) blank = false
    })
  })
  return blank
}

function countEmptyCellsFromEnd(
  editor: Editor,
  tablePos: number,
  orientation: Orientation,
): number {
  const table = getTable(editor, tablePos)
  if (!table) return 0

  const { doc } = editor.state
  const maxIndex = orientation === 'row' ? table.map.height : table.map.width
  let emptyCount = 0

  for (let idx = maxIndex - 1; idx >= 0; idx--) {
    const seen = new Set<number>()
    let isLineEmpty = true
    const iterationCount = orientation === 'row' ? table.map.width : table.map.height

    for (let i = 0; i < iterationCount; i++) {
      const row = orientation === 'row' ? idx : i
      const col = orientation === 'row' ? i : idx
      const rel = table.map.positionAt(row, col, table.node)
      if (seen.has(rel)) continue
      seen.add(rel)

      const abs = tablePos + 1 + rel
      const cell = doc.nodeAt(abs)
      if (!cell) continue
      if (!isCellBlank(cell)) {
        isLineEmpty = false
        break
      }
    }

    if (isLineEmpty) emptyCount++
    else break
  }

  return emptyCount
}

export function isCellEmpty(cellNode: Node): boolean {
  if (cellNode.childCount === 0) return true
  let isEmpty = true
  cellNode.descendants((n) => {
    if (n.isText && n.text?.trim()) {
      isEmpty = false
      return false
    }
    if (n.isLeaf && !n.isText) {
      isEmpty = false
      return false
    }
    return true
  })
  return isEmpty
}

export function cellsOverlapRectangle(
  { width, height, map }: TableMap,
  rect: Rect,
): boolean {
  let indexTop = rect.top * width + rect.left
  let indexLeft = indexTop
  let indexBottom = (rect.bottom - 1) * width + rect.left
  let indexRight = indexTop + (rect.right - rect.left - 1)

  for (let i = rect.top; i < rect.bottom; i++) {
    if (
      (rect.left > 0 && map[indexLeft] === map[indexLeft - 1]) ||
      (rect.right < width && map[indexRight] === map[indexRight + 1])
    ) {
      return true
    }
    indexLeft += width
    indexRight += width
  }
  for (let i = rect.left; i < rect.right; i++) {
    if (
      (rect.top > 0 && map[indexTop] === map[indexTop - width]) ||
      (rect.bottom < height && map[indexBottom] === map[indexBottom + width])
    ) {
      return true
    }
    indexTop++
    indexBottom++
  }
  return false
}

export function runPreservingCursor(editor: Editor, fn: () => void): boolean {
  const view = editor.view
  const startSel = view.state.selection
  const bookmark = startSel.getBookmark()
  const mapping = new Mapping()

  const collectMapping = ({ transaction, appendedTransactions }: any) => {
    mapping.appendMapping(transaction.mapping)
    for (const appended of appendedTransactions ?? []) {
      mapping.appendMapping(appended.mapping)
    }
  }

  editor.on('transaction', collectMapping)
  try {
    fn()
  } finally {
    editor.off('transaction', collectMapping)
  }

  try {
    const sel = bookmark.map(mapping).resolve(view.state.doc)
    view.dispatch(view.state.tr.setSelection(sel))
    return true
  } catch {
    const mappedPos = mapping.map(startSel.from, -1)
    const clamped = clamp(mappedPos, 0, view.state.doc.content.size)
    const near = Selection.near(view.state.doc.resolve(clamped), -1)
    view.dispatch(view.state.tr.setSelection(near))
    return false
  }
}

export function getTableSelectionType(
  editor: Editor | null,
  index?: number,
  orientation?: Orientation,
  tablePos?: number,
): { orientation: Orientation; index: number } | null {
  if (typeof index === 'number' && orientation) return { orientation, index }
  if (!editor) return null

  const { state } = editor
  const table = getTable(editor, tablePos)
  if (!table) return null

  if (state.selection instanceof CellSelection) {
    const rect = selectedRect(state)
    if (rect.tableStart !== table.start) return null

    const width = rect.right - rect.left
    const height = rect.bottom - rect.top
    if (height === 1 && width >= 1) return { orientation: 'row', index: rect.top }
    if (width === 1 && height >= 1) return { orientation: 'column', index: rect.left }
    return null
  }
  return null
}

export function getRowOrColumnCells(
  editor: Editor | null,
  index?: number,
  orientation?: Orientation,
  tablePos?: number,
): { cells: CellInfo[]; mergedCells: CellInfo[]; index?: number; orientation?: Orientation } {
  const emptyResult = { cells: [], mergedCells: [], index: undefined, orientation: undefined }
  if (!editor) return emptyResult

  if (typeof index !== 'number' && !(editor.state.selection instanceof CellSelection)) {
    return emptyResult
  }

  let finalIndex = index
  let finalOrientation = orientation
  if (
    typeof finalIndex !== 'number' ||
    !finalOrientation ||
    !['row', 'column'].includes(finalOrientation)
  ) {
    const selectionType = getTableSelectionType(editor, undefined, undefined, tablePos)
    if (!selectionType) return emptyResult
    finalIndex = selectionType.index
    finalOrientation = selectionType.orientation
  }

  const result = collectCells(editor, finalOrientation!, finalIndex, tablePos)
  return { ...result, index: finalIndex, orientation: finalOrientation }
}

export function getRowCells(editor: Editor | null, rowIndex?: number, tablePos?: number) {
  return collectCells(editor, 'row', rowIndex, tablePos)
}

export function getColumnCells(editor: Editor | null, columnIndex?: number, tablePos?: number) {
  return collectCells(editor, 'column', columnIndex, tablePos)
}

export function updateSelectionAfterAction(
  editor: Editor,
  orientation: Orientation,
  newIndex: number,
  tablePos?: number,
): void {
  try {
    const table = getTable(editor, tablePos)
    if (!table) return
    const { state } = editor
    const { map } = table

    if (orientation === 'row' && newIndex >= 0 && newIndex < map.height) {
      const startCol = 0
      let endCol = map.width - 1
      while (
        endCol > startCol &&
        map.findCell(map.map[newIndex * map.width + endCol]!).top < newIndex
      ) {
        endCol--
      }
      const startCellPos = table.start + map.positionAt(newIndex, startCol, table.node)
      const endCellPos = table.start + map.positionAt(newIndex, endCol, table.node)
      const sel = CellSelection.create(state.doc, state.doc.resolve(startCellPos).pos, state.doc.resolve(endCellPos).pos)
      editor.view.dispatch(state.tr.setSelection(sel))
    } else if (orientation === 'column' && newIndex >= 0 && newIndex < map.width) {
      const startRow = 0
      const endRow = map.findCell(map.map[(map.height - 1) * map.width + newIndex]!).top
      const startCellPos = table.start + map.positionAt(startRow, newIndex, table.node)
      const endCellPos = table.start + map.positionAt(endRow, newIndex, table.node)
      const sel = CellSelection.create(state.doc, state.doc.resolve(startCellPos).pos, state.doc.resolve(endCellPos).pos)
      editor.view.dispatch(state.tr.setSelection(sel))
    }
  } catch (error) {
    console.warn('Failed to update selection after action:', error)
  }
}

export function setCellAttr(nameOrAttrs: string | Record<string, unknown>, value?: unknown) {
  return (state: EditorState, dispatch?: (tr: Transaction) => void) => {
    if (!isInTable(state)) return false
    const $cell = selectionCell(state)
    const attrs = typeof nameOrAttrs === 'string' ? { [nameOrAttrs]: value } : nameOrAttrs

    if (dispatch) {
      const tr = state.tr
      if (state.selection instanceof CellSelection) {
        state.selection.forEachCell((node, pos) => {
          const needsUpdate = Object.entries(attrs).some(([name, val]) => node.attrs[name] !== val)
          if (needsUpdate) {
            tr.setNodeMarkup(pos, null, { ...node.attrs, ...attrs })
          }
        })
      } else {
        const needsUpdate = Object.entries(attrs).some(([name, val]) => $cell.nodeAfter!.attrs[name] !== val)
        if (needsUpdate) {
          tr.setNodeMarkup($cell.pos, null, { ...$cell.nodeAfter!.attrs, ...attrs })
        }
      }
      if (!tr.docChanged) return false
      dispatch(tr)
    }
    return true
  }
}

export function countEmptyRowsFromEnd(editor: Editor, tablePos: number): number {
  return countEmptyCellsFromEnd(editor, tablePos, 'row')
}

export function countEmptyColumnsFromEnd(editor: Editor, tablePos: number): number {
  return countEmptyCellsFromEnd(editor, tablePos, 'column')
}

export function marginRound(num: number, margin = 0.3): number {
  const floor = Math.floor(num)
  const ceil = Math.ceil(num)
  const lowerBound = floor + margin
  const upperBound = ceil - margin
  if (num < lowerBound) return floor
  if (num > upperBound) return ceil
  return Math.round(num)
}

export function rectEq(a?: DOMRect | null, b?: DOMRect | null): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height
}

export function getCellPosition(
  state: EditorState,
  tablePosition: number,
  cellCoordinates: CellCoordinates,
) {
  const resolvedTablePosition = state.doc.resolve(tablePosition)
  const resolvedRowPosition = state.doc.resolve(
    resolvedTablePosition.posAtIndex(cellCoordinates.row) + 1,
  )
  const resolvedColPosition = state.doc.resolve(resolvedRowPosition.posAtIndex(cellCoordinates.col))
  const $cell = cellAround(resolvedColPosition)
  if (!$cell) return null
  return resolvedColPosition
}

export function createTableCellSelection(
  state: EditorState,
  tablePosition: number,
  startCell: CellCoordinates,
  endCell: CellCoordinates = startCell,
): EditorState | null {
  const startCellPosition = getCellPosition(state, tablePosition, startCell)
  const endCellPosition = getCellPosition(state, tablePosition, endCell)
  if (!startCellPosition || !endCellPosition) return null
  const transaction = state.tr.setSelection(new CellSelection(startCellPosition, endCellPosition))
  return state.apply(transaction)
}

export function selectCellsByCoords(
  editor: Editor | null,
  tablePos: number,
  coords: CellCoordinates[],
  options: { mode?: 'state' | 'dispatch'; dispatch?: (tr: Transaction) => void } = { mode: 'state' },
): EditorState | boolean | null {
  if (!editor) return null
  const table = getTable(editor, tablePos)
  if (!table) return null
  const { state } = editor
  const tableMap = table.map

  const cleanedCoords = coords
    .map((coord) => ({
      row: clamp(coord.row, 0, tableMap.height - 1),
      col: clamp(coord.col, 0, tableMap.width - 1),
    }))
    .filter((coord) => isWithinBounds(coord.row, coord.col, tableMap))

  if (cleanedCoords.length === 0) return null

  const topRow = Math.min(...cleanedCoords.map((c) => c.row))
  const bottomRow = Math.max(...cleanedCoords.map((c) => c.row))
  const leftCol = Math.min(...cleanedCoords.map((c) => c.col))
  const rightCol = Math.max(...cleanedCoords.map((c) => c.col))

  const getCellPositionFromMap = (row: number, col: number): number | null => {
    const cellOffset = tableMap.map[row * tableMap.width + col]
    if (cellOffset === undefined) return null
    return tablePos + 1 + cellOffset
  }

  const anchorPosition = getCellPositionFromMap(topRow, leftCol)
  let headPosition = getCellPositionFromMap(bottomRow, rightCol)
  if (anchorPosition === null || headPosition === null) return null

  if (headPosition === anchorPosition) {
    let foundDifferentCell = false
    for (let row = bottomRow; row >= topRow && !foundDifferentCell; row--) {
      for (let col = rightCol; col >= leftCol && !foundDifferentCell; col--) {
        const candidatePosition = getCellPositionFromMap(row, col)
        if (candidatePosition !== null && candidatePosition !== anchorPosition) {
          headPosition = candidatePosition
          foundDifferentCell = true
        }
      }
    }
  }

  try {
    const anchorRef = state.doc.resolve(anchorPosition)
    const headRef = state.doc.resolve(headPosition)
    const cellSelection = new CellSelection(anchorRef, headRef)
    const transaction = state.tr.setSelection(cellSelection)

    if (options.mode === 'dispatch') {
      options.dispatch?.(transaction)
      return true
    }
    return state.apply(transaction)
  } catch (error) {
    console.error('Failed to create cell selection:', error)
    return null
  }
}

export function selectCellAt({
  editor,
  row,
  col,
  tablePos,
  dispatch,
}: {
  editor: Editor | null
  row: number
  col: number
  tablePos?: number
  dispatch?: (tr: Transaction) => void
}): boolean {
  if (!editor) return false
  const { state, view } = editor
  const found = getTable(editor, tablePos)
  if (!found) return false
  if (!isWithinBounds(row, col, found.map)) return false

  const cellPos = found.start + found.map.map[row * found.map.width + col]!
  const sel = CellSelection.create(state.doc, cellPos)
  const doDispatch = dispatch ?? view.dispatch
  doDispatch(state.tr.setSelection(sel))
  return true
}

export function selectLastCell(
  editor: Editor,
  tableNode: Node,
  tablePos: number,
  orientation: Orientation,
): boolean {
  const table = getTable(editor, tablePos)
  if (!table) return false
  const { map } = table
  const isRow = orientation === 'row'
  const row = isRow ? map.height - 1 : 0
  const col = isRow ? 0 : map.width - 1
  const index = row * map.width + col
  const cellPos = map.map[index]
  if (!cellPos && cellPos !== 0) return false

  const cellIndex = map.map.indexOf(cellPos)
  const actualRow = cellIndex >= 0 ? Math.floor(cellIndex / map.width) : 0
  const actualCol = cellIndex >= 0 ? cellIndex % map.width : 0
  return selectCellAt({ editor, row: actualRow, col: actualCol, tablePos })
}

export function getIndexCoordinates({
  editor,
  index,
  orientation,
  tablePos,
}: {
  editor: Editor | null
  index: number
  orientation?: Orientation
  tablePos?: number
}): CellCoordinates[] | null {
  if (!editor) return null
  const table = getTable(editor, tablePos)
  if (!table) return null
  const { map } = table
  const { width, height } = map
  if (index < 0) return null
  if (orientation === 'row' && index >= height) return null
  if (orientation === 'column' && index >= width) return null

  return orientation === 'row'
    ? Array.from({ length: map.width }, (_, col) => ({ row: index, col }))
    : Array.from({ length: map.height }, (_, row) => ({ row, col: index }))
}

export function getCellIndicesFromDOM(
  cell: HTMLTableCellElement,
  tableNode: Node | null,
  editor: Editor,
): { rowIndex: number; colIndex: number } | null {
  if (!tableNode) return null
  try {
    const cellPos = editor.view.posAtDOM(cell, 0)
    const $cellPos = editor.view.state.doc.resolve(cellPos)
    for (let d = $cellPos.depth; d > 0; d--) {
      const node = $cellPos.node(d)
      if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
        if ($cellPos.node(d - 2) !== tableNode) return null
        const tableMap = TableMap.get(tableNode)
        const cellNodePos = $cellPos.before(d)
        const tableStart = $cellPos.start(d - 2)
        const cellOffset = cellNodePos - tableStart
        const cellIndex = tableMap.map.indexOf(cellOffset)
        return {
          rowIndex: Math.floor(cellIndex / tableMap.width),
          colIndex: cellIndex % tableMap.width,
        }
      }
    }
  } catch (error) {
    console.warn('Could not get cell position:', error)
  }
  return null
}

export function getTableFromDOM(
  tableElement: HTMLElement,
  editor: Editor,
): { node: Node; pos: number } | null {
  try {
    const pos = editor.view.posAtDOM(tableElement, 0)
    const $pos = editor.view.state.doc.resolve(pos)
    for (let d = $pos.depth; d >= 0; d--) {
      const node = $pos.node(d)
      if (isTableNode(node)) {
        return { node, pos: d === 0 ? 0 : $pos.before(d) }
      }
    }
  } catch (error) {
    console.warn('Could not get table from DOM:', error)
  }
  return null
}

export function isTableNode(node: Node | null | undefined): node is Node {
  return !!node && (node.type.name === 'table' || node.type.spec.tableRole === 'table')
}
