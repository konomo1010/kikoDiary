<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { Editor } from '@tiptap/core'
import { CellSelection, TableMap } from '@tiptap/pm/tables'
import { TextSelection } from '@tiptap/pm/state'
import { injectEditor } from '../composables/useEditor'
import {
  createTableDragImage,
  extendCellSize,
  extendColumns,
  extendRows,
  moveRowColumnTo,
  setColumnWidth,
  setRowHeight,
} from '../composables/useTableActions'
import {
  domCellAround,
  getCellIndicesFromDOM,
  getTableFromDOM,
  getTable,
  getColumnCells,
  rectEq,
  selectCellsByCoords,
} from '../lib/table/tableUtils'
import TableHandleMenu from './table/TableHandleMenu.vue'
import TableCellMenu from './table/TableCellMenu.vue'

const editor = injectEditor()

const state = reactive({
  show: false,
  tablePos: -1,
  block: null as any,
  rowIndex: undefined as number | undefined,
  colIndex: undefined as number | undefined,
  showAddRow: false,
  showAddColumn: false,
  referencePosTable: null as DOMRect | null,
  referencePosCell: null as DOMRect | null,
  referencePosWrapper: null as DOMRect | null,
  referencePosRow: null as DOMRect | null,
  referencePosRowEl: null as HTMLElement | null,
})

const rowMenuOpen = ref(false)
const colMenuOpen = ref(false)
const cellMenuOpen = ref(false)

// 行/列/单元格菜单打开时隐藏浮动文字工具栏，避免它盖在菜单上。
watch([rowMenuOpen, colMenuOpen, cellMenuOpen], (values) => {
  document.body.classList.toggle('table-menu-open', values.some(Boolean))
})

const dragState = ref<null | {
  orientation: 'row' | 'column'
  index: number
  tablePos: number
  image: HTMLElement | null
}>(null)
const dropIndicator = ref<{ orientation: 'row' | 'column'; left: number; top: number; length: number } | null>(null)

const rowHandleStyle = computed(() => {
  const cell = state.referencePosCell
  const table = state.referencePosTable
  if (!cell || !table) return {}
  const wrapper = state.referencePosWrapper
  // 表格被横向滚出可视区时，把手贴住可视左边缘，不画到表格外。
  const visibleLeft = wrapper ? Math.max(table.left, wrapper.left) : table.left
  return {
    left: `${visibleLeft - 4}px`,
    top: `${cell.top + cell.height / 2}px`,
    width: '12px',
    height: `${Math.max(cell.height, 16)}px`,
  }
})

const colHandleStyle = computed(() => {
  const cell = state.referencePosCell
  const table = state.referencePosTable
  if (!cell || !table) return {}
  const wrapper = state.referencePosWrapper
  const visibleTop = visibleContentTop(table, wrapper)
  return {
    left: `${cell.left + cell.width / 2}px`,
    top: `${visibleTop - 4}px`,
    width: `${Math.max(cell.width, 16)}px`,
    height: '12px',
  }
})

const rowExtendStyle = computed(() => {
  const table = state.referencePosTable
  if (!table) return {}
  const wrapper = state.referencePosWrapper
  const left = wrapper ? Math.max(table.left, wrapper.left) : table.left
  const right = wrapper ? Math.min(table.right, wrapper.right) : table.right
  return {
    left: `${left}px`,
    top: `${table.bottom + 4}px`,
    width: `${Math.max(0, right - left)}px`,
    height: '12px',
  }
})

function visibleContentTop(table: DOMRect, _wrapper: DOMRect | null): number {
  const toolbar = document.querySelector('.tiptap-toolbar') as HTMLElement | null
  const toolbarBottom = toolbar ? toolbar.getBoundingClientRect().bottom : 0
  // 正常情况锚定表格顶边；只有表格顶边被工具栏遮住时才用工具栏底部。
  return Math.max(table.top, toolbarBottom)
}

const colExtendStyle = computed(() => {
  const table = state.referencePosTable
  if (!table) return {}
  const wrapper = state.referencePosWrapper
  const top = visibleContentTop(table, wrapper)
  const bottom = wrapper ? Math.min(table.bottom, wrapper.bottom) : table.bottom
  const left = wrapper ? Math.min(table.right, wrapper.right) : table.right
  return {
    left: `${left + 4}px`,
    top: `${top}px`,
    width: '12px',
    height: `${Math.max(0, bottom - top)}px`,
  }
})

// 表格顶部被滚到工具栏/可视区上方时，列把手会浮在工具栏上，直接隐藏。
const showColumnHandle = computed(() => {
  const table = state.referencePosTable
  const wrapper = state.referencePosWrapper
  if (!table || !wrapper) return true
  return table.top >= visibleContentTop(table, wrapper)
})

const rowResizeVisible = computed(() => {
  const row = state.referencePosRow
  const table = state.referencePosTable
  if (!row || !table || state.rowIndex == null) return false
  const wrapper = state.referencePosWrapper
  const top = visibleContentTop(table, wrapper)
  const bottom = wrapper ? Math.min(table.bottom, wrapper.bottom) : table.bottom
  return row.bottom > top && row.bottom < bottom + 12
})

const rowResizeStyle = computed(() => {
  const row = state.referencePosRow
  const table = state.referencePosTable
  if (!row || !table) return {}
  const wrapper = state.referencePosWrapper
  const left = wrapper ? Math.max(table.left, wrapper.left) : table.left
  const right = wrapper ? Math.min(table.right, wrapper.right) : table.right
  return {
    left: `${left}px`,
    top: `${row.bottom - 4}px`,
    width: `${Math.max(0, right - left)}px`,
    height: '8px',
  }
})

const colResizeVisible = computed(() => {
  const cell = state.referencePosCell
  const table = state.referencePosTable
  if (!cell || !table || state.colIndex == null) return false
  const wrapper = state.referencePosWrapper
  const top = visibleContentTop(table, wrapper)
  const bottom = wrapper ? Math.min(table.bottom, wrapper.bottom) : table.bottom
  return bottom > top
})

const colResizeStyle = computed(() => {
  const cell = state.referencePosCell
  const table = state.referencePosTable
  if (!cell || !table) return {}
  const wrapper = state.referencePosWrapper
  const top = visibleContentTop(table, wrapper)
  const bottom = wrapper ? Math.min(table.bottom, wrapper.bottom) : table.bottom
  return {
    left: `${cell.right - 4}px`,
    top: `${top}px`,
    width: '8px',
    height: `${Math.max(0, bottom - top)}px`,
  }
})

function autoFitCurrentColumn() {
  const e = editor?.value
  if (!e || state.colIndex == null || state.tablePos < 0) return
  autoFitColumn(e, state.tablePos, state.colIndex)
}

function startColumnResize(event: PointerEvent) {
  const e = editor?.value
  const cell = state.referencePosCell
  if (!e || !cell || state.colIndex == null || state.tablePos < 0) return
  event.preventDefault()
  event.stopPropagation()

  const tablePos = state.tablePos
  const colIndex = state.colIndex
  const startX = event.clientX
  const startWidth = cell.width
  let lastWidth = Math.round(startWidth)

  const onMove = (ev: PointerEvent) => {
    const width = Math.min(800, Math.max(35, Math.round(startWidth + ev.clientX - startX)))
    if (width === lastWidth) return
    lastWidth = width
    setColumnWidth(e, tablePos, colIndex, width)
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
}

function startRowResize(event: PointerEvent) {
  const e = editor?.value
  const row = state.referencePosRow
  if (!e || !row || state.rowIndex == null || state.tablePos < 0) return
  event.preventDefault()
  event.stopPropagation()

  const rowIndex = state.rowIndex
  const tablePos = state.tablePos
  const startY = event.clientY
  const startHeight = row.height
  let lastHeight = Math.round(startHeight)

  const onMove = (ev: PointerEvent) => {
    const height = Math.max(30, Math.round(startHeight + ev.clientY - startY))
    if (height === lastHeight) return
    lastHeight = height
    setRowHeight(e, tablePos, rowIndex, height)
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
}

function resetRowHeight() {
  const e = editor?.value
  if (!e || state.rowIndex == null || state.tablePos < 0) return
  setRowHeight(e, state.tablePos, state.rowIndex, null)
}

function fitRowHeight() {
  const e = editor?.value
  const rowEl = state.referencePosRowEl
  if (!e || !rowEl || state.rowIndex == null || state.tablePos < 0) return
  const cells = Array.from(rowEl.children) as HTMLElement[]
  let contentHeight = 0
  for (const cell of cells) {
    let height = 0
    for (const child of Array.from(cell.children) as HTMLElement[]) {
      height += child.getBoundingClientRect().height
    }
    contentHeight = Math.max(contentHeight, height)
  }
  setRowHeight(e, state.tablePos, state.rowIndex, Math.ceil(contentHeight) + 4)
}

function autoFitColumn(e: Editor, tablePos: number, colIndex: number) {
  const table = getTable(e, tablePos)
  if (!table) return
  const column = getColumnCells(e, colIndex, tablePos)
  if (!column.cells.length) return

  let contentWidth = 0
  for (const cell of column.cells) {
    if (!cell.node) continue
    const dom = e.view.nodeDOM(cell.pos) as HTMLElement | null
    if (!dom) continue
    const style = getComputedStyle(dom)
    const span = document.createElement('span')
    span.style.cssText = `position:fixed;left:-99999px;top:0;visibility:hidden;white-space:pre;font:${style.font};`
    span.textContent = dom.innerText.replace(/\n+/g, ' ')
    document.body.appendChild(span)
    let width = span.getBoundingClientRect().width
    span.remove()
    dom.querySelectorAll('img').forEach((img) => {
      width = Math.max(width, img.naturalWidth || img.width || 0)
    })
    width +=
      (Number.parseFloat(style.paddingLeft) || 0) +
      (Number.parseFloat(style.paddingRight) || 0) +
      2
    contentWidth = Math.max(contentWidth, width)
  }

  const width = Math.min(800, Math.max(60, Math.ceil(contentWidth) + 4))
  const tr = e.state.tr
  for (const cell of column.cells) {
    if (!cell.node) continue
    tr.setNodeMarkup(cell.pos, null, { ...cell.node.attrs, colwidth: [width] })
  }
  if (tr.docChanged) e.view.dispatch(tr)
}

function onDocDblclick(event: MouseEvent) {
  const target = event.target
  if (!(target instanceof Element)) return
  const e = editor?.value
  if (!e) return

  const handle = target.closest('.column-resize-handle')
  const cell = (handle?.closest('td,th') ?? target.closest('td,th')) as HTMLElement | null
  if (!cell) return

  // 没有 handle 时，双击单元格右边界 6px 内也触发自动列宽（Excel 式）。
  if (!handle) {
    const rect = cell.getBoundingClientRect()
    if (event.clientX < rect.right - 6) return
  }

  const info = getTableFromDOM(cell, e)
  if (!info) return
  const indices = getCellIndicesFromDOM(cell, info.node, e)
  if (!indices) return
  event.preventDefault()
  event.stopPropagation()
  autoFitColumn(e, info.pos, indices.colIndex)
}

function hide() {
  state.show = false
  state.showAddRow = false
  state.showAddColumn = false
  state.rowIndex = undefined
  state.colIndex = undefined
  state.referencePosCell = undefined
  state.referencePosRow = undefined
  state.referencePosRowEl = null
  rowMenuOpen.value = false
  colMenuOpen.value = false
  cellMenuOpen.value = false
}

function startRowMoveDrag(event: DragEvent) {
  const e = editor?.value
  if (!e || state.rowIndex == null) return
  const image = createTableDragImage(e, 'row', state.rowIndex, state.tablePos)
  dragState.value = { orientation: 'row', index: state.rowIndex, tablePos: state.tablePos, image }
  if (event.dataTransfer && image) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setDragImage(image, 8, 8)
  }
}

function startColumnMoveDrag(event: DragEvent) {
  const e = editor?.value
  if (!e || state.colIndex == null) return
  const image = createTableDragImage(e, 'column', state.colIndex, state.tablePos)
  dragState.value = { orientation: 'column', index: state.colIndex, tablePos: state.tablePos, image }
  if (event.dataTransfer && image) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setDragImage(image, 8, 8)
  }
}

function onDragOver(event: DragEvent) {
  const d = dragState.value
  const e = editor?.value
  if (!d || !e) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'

  const target = event.target
  if (!(target instanceof Element)) return
  const cell = target.closest('td,th') as HTMLTableCellElement | null
  if (!cell) {
    dropIndicator.value = null
    return
  }
  const indices = getCellIndicesFromDOM(cell, getTableFromDOM(cell, e)?.node ?? null, e)
  if (!indices) return
  const rect = cell.getBoundingClientRect()
  const index = d.orientation === 'row' ? indices.rowIndex : indices.colIndex
  const origin = d.index

  // Draw the drop cursor on the leading edge of the target line.
  if (index === origin) {
    dropIndicator.value = null
    return
  }
  const after = index > origin
  if (d.orientation === 'row') {
    dropIndicator.value = {
      orientation: 'row',
      left: rect.left,
      top: after ? rect.bottom : rect.top,
      length: rect.width,
    }
  } else {
    dropIndicator.value = {
      orientation: 'column',
      left: after ? rect.right : rect.left,
      top: rect.top,
      length: rect.height,
    }
  }
}

function onDragEnd() {
  const d = dragState.value
  if (d) {
    d.image?.parentNode?.removeChild(d.image)
  }
  dragState.value = null
  dropIndicator.value = null
}

function onDrop(event: DragEvent) {
  const d = dragState.value
  const e = editor?.value
  if (!d || !e) return
  event.preventDefault()

  const target = event.target
  if (target instanceof Element) {
    const cell = target.closest('td,th') as HTMLTableCellElement | null
    if (cell) {
      const indices = getCellIndicesFromDOM(cell, getTableFromDOM(cell, e)?.node ?? null, e)
      if (indices) {
        const targetIndex = d.orientation === 'row' ? indices.rowIndex : indices.colIndex
        moveRowColumnTo(e, d.index, d.orientation, targetIndex, d.tablePos)
      }
    }
  }
  onDragEnd()
}

function isPointerInHandleBridge(event: MouseEvent) {
  const { referencePosCell, referencePosTable } = state
  if (!referencePosCell || !referencePosTable) return false
  const x = event.clientX
  const y = event.clientY

  const withinColumn = x >= referencePosCell.left && x <= referencePosCell.right
  const betweenColumnHandleAndTable = y >= referencePosTable.top - 4 && y <= referencePosTable.top
  const withinRow = y >= referencePosCell.top && y <= referencePosCell.bottom
  const betweenRowHandleAndTable = x >= referencePosTable.left - 4 && x <= referencePosTable.left

  return (
    (withinColumn && betweenColumnHandleAndTable) ||
    (withinRow && betweenRowHandleAndTable)
  )
}

function visibleEdges(table: DOMRect, wrapper: DOMRect | null) {
  return {
    right: wrapper ? Math.min(table.right, wrapper.right) : table.right,
    bottom: wrapper ? Math.min(table.bottom, wrapper.bottom) : table.bottom,
  }
}

function updateHover(event: MouseEvent) {
  const e = editor?.value
  if (!e || !e.isEditable || rowMenuOpen.value || colMenuOpen.value || cellMenuOpen.value) return

  const target = event.target
  if (target instanceof Element && target.closest('.table-handle-floating, .table-handle-menu-dropdown, .table-extend-btn, .table-selection-overlay, .table-cell-menu-btn, .table-row-resize, .table-col-resize')) {
    return
  }

  const around = domCellAround(target instanceof Element ? target : (event.target as Element))
  if (!around) {
    // 与 my-app 一致：鼠标在表格右侧/底部 20px 范围内，即使已经离开
    // .tableWrapper（编辑器空白处），也保留对应的 + / 把手。
    const table = state.referencePosTable
    if (table) {
      const edges = visibleEdges(table, state.referencePosWrapper)
      const nearRight =
        event.clientX >= edges.right - 1 && event.clientX < edges.right + 20
      const nearBottom =
        event.clientY >= edges.bottom - 1 && event.clientY < edges.bottom + 20
      if (nearRight || nearBottom) {
        state.show = true
        state.showAddColumn = nearRight
        state.showAddRow = nearBottom
        return
      }
    }
    if (isPointerInHandleBridge(event)) return
    hide()
    return
  }

  const tbody = around.tbodyNode
  if (!tbody) return

  const tableRect = tbody.getBoundingClientRect()

  if (around.type === 'cell') {
    const cell = around.domNode as HTMLTableCellElement
    const tableInfo = getTableFromDOM(cell, e)
    if (!tableInfo || tableInfo.node.type.name !== 'table') {
      hide()
      return
    }
    const indices = getCellIndicesFromDOM(cell, tableInfo.node, e)
    if (!indices) {
      hide()
      return
    }
    const map = TableMap.get(tableInfo.node)
    const lastRowIndex = map.height - 1
    const lastColIndex = map.width - 1

    state.show = true
    state.tablePos = tableInfo.pos
    state.block = tableInfo.node
    state.rowIndex = indices.rowIndex
    state.colIndex = indices.colIndex
    state.referencePosTable = tableRect
    state.referencePosCell = cell.getBoundingClientRect()
    const rowEl = cell.closest('tr') as HTMLElement | null
    state.referencePosRowEl = rowEl
    state.referencePosRow = rowEl ? rowEl.getBoundingClientRect() : null
    const cellWrapper = cell.closest('.tableWrapper') as HTMLElement | null
    state.referencePosWrapper = cellWrapper ? cellWrapper.getBoundingClientRect() : null
    const edges = visibleEdges(tableRect, state.referencePosWrapper)
    // 横向滚动后真实最后一列可能在可视区外：靠近可视右/下边缘也显示对应 +。
    state.showAddRow =
      indices.rowIndex === lastRowIndex || event.clientY >= edges.bottom - 20
    state.showAddColumn =
      indices.colIndex === lastColIndex || event.clientX >= edges.right - 20
  } else {
    // Wrapper hover：与 my-app 一致，按右侧/底部 20px 带精确判定 + 是否显示。
    const wrapper = around.domNode as HTMLElement
    const tableInfo = getTableFromDOM(wrapper, e)
    if (!tableInfo || tableInfo.node.type.name !== 'table') {
      hide()
      return
    }
    state.referencePosWrapper = wrapper.getBoundingClientRect()
    const edges = visibleEdges(tableRect, state.referencePosWrapper)

    const below =
      event.clientY >= edges.bottom - 1 && event.clientY < edges.bottom + 20
    const right =
      event.clientX >= edges.right - 1 && event.clientX < edges.right + 20
    const cursorBeyondRightOrBottom =
      event.clientX > edges.right || event.clientY > edges.bottom
    // 只有不越过右/下边缘、且仍在同一张表时，才保留上一格子的把手。
    const keepCell =
      !cursorBeyondRightOrBottom && state.tablePos === tableInfo.pos

    state.show = true
    state.showAddRow = below
    state.showAddColumn = right
    state.referencePosTable = tableRect
    state.block = tableInfo.node
    state.tablePos = tableInfo.pos
    state.rowIndex = keepCell ? state.rowIndex : undefined
    state.colIndex = keepCell ? state.colIndex : undefined
    state.referencePosCell = keepCell ? state.referencePosCell : undefined
  }

  bindScrollContainers(tbody)
}

function refreshLayout() {
  const e = editor?.value
  if (!e || !state.show || state.tablePos < 0) return
  const dom = e.view.nodeDOM(state.tablePos) as HTMLElement | undefined
  const tbody = dom?.querySelector('tbody')
  if (!tbody) return

  const tableRect = tbody.getBoundingClientRect()
  if (!state.referencePosTable || !rectEq(state.referencePosTable, tableRect)) {
    state.referencePosTable = tableRect
  }
  const wrapperEl = tbody.closest('.tableWrapper') as HTMLElement | null
  if (wrapperEl) {
    const wrapperRect = wrapperEl.getBoundingClientRect()
    if (!state.referencePosWrapper || !rectEq(state.referencePosWrapper, wrapperRect)) {
      state.referencePosWrapper = wrapperRect
    }
  }

  const node = e.state.doc.nodeAt(state.tablePos)
  if (!node || node.type.name !== 'table') return
  state.block = node

  if (state.rowIndex == null || state.colIndex == null) return
  const map = TableMap.get(node)
  if (state.rowIndex >= map.height || state.colIndex >= map.width) return
  const cellDom = e.view.nodeDOM(
    state.tablePos + 1 + map.map[state.rowIndex * map.width + state.colIndex]!,
  )
  if (!cellDom) return
  // 悬停单元格被滚出表格可视区时隐藏把手，避免 fixed 浮层画到表格外。
  if (!visibleInWrapper(cellDom as Element)) {
    hide()
    return
  }
  const cellRect = (cellDom as HTMLElement).getBoundingClientRect()
  if (!state.referencePosCell || !rectEq(state.referencePosCell, cellRect)) {
    state.referencePosCell = cellRect
  }
  const rowEl = (cellDom as HTMLElement).closest('tr')
  const rowRect = rowEl ? rowEl.getBoundingClientRect() : null
  state.referencePosRowEl = rowEl
  if (!state.referencePosRow || !rowRect || !rectEq(state.referencePosRow, rowRect)) {
    state.referencePosRow = rowRect
  }
}

// 嵌套滚动容器（.tableWrapper / 编辑器）的 scroll 不会可靠到达 window，
// 直接绑定到容器上，保证横向滚动时把手同步。
const boundScrollEls: HTMLElement[] = []

function bindScrollContainers(tbody: HTMLElement) {
  const candidates = [
    tbody.closest('.tableWrapper') as HTMLElement | null,
    editor?.value?.view.dom.closest('.notion-like-editor-wrapper') as HTMLElement | null,
  ]
  for (const el of candidates) {
    if (el && !boundScrollEls.includes(el)) {
      el.addEventListener('scroll', refreshLayout, { passive: true })
      boundScrollEls.push(el)
    }
  }
}

// 每帧刷新位置：横向滚动（tableWrapper / 编辑器）时把手必须跟随表格，
// 只靠 scroll 事件在嵌套滚动容器里并不可靠。
let layoutRaf = 0
function layoutLoop() {
  refreshLayout()
  updateSelectionRect()
  layoutRaf = requestAnimationFrame(layoutLoop)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') hide()
}

function onMousemove(event: MouseEvent) {
  updateHover(event)
}

watch(
  () => editor?.value,
  (next, prev) => {
    prev?.off('transaction', refreshLayout)
    prev?.off('selectionUpdate', refreshLayout)
    prev?.off('transaction', bumpSelection)
    prev?.off('selectionUpdate', bumpSelection)
    next?.on('transaction', refreshLayout)
    next?.on('selectionUpdate', refreshLayout)
    next?.on('transaction', bumpSelection)
    next?.on('selectionUpdate', bumpSelection)
  },
  { immediate: true },
)

function bumpSelection() {
  updateSelectionRect()
}

onMounted(() => {
  window.addEventListener('mousemove', onMousemove, true)
  window.addEventListener('scroll', refreshLayout, true)
  window.addEventListener('resize', refreshLayout)
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('drop', onDrop)
  document.addEventListener('keydown', onKeydown)
  document.addEventListener('mousedown', onDocMousedown, true)
  document.addEventListener('dblclick', onDocDblclick, true)
  layoutRaf = requestAnimationFrame(layoutLoop)
})

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onMousemove, true)
  window.removeEventListener('scroll', refreshLayout, true)
  window.removeEventListener('resize', refreshLayout)
  window.removeEventListener('dragover', onDragOver)
  window.removeEventListener('drop', onDrop)
  document.removeEventListener('keydown', onKeydown)
  document.removeEventListener('mousedown', onDocMousedown, true)
  document.removeEventListener('dblclick', onDocDblclick, true)
  document.body.classList.remove('table-menu-open')
  for (const el of boundScrollEls) el.removeEventListener('scroll', refreshLayout)
  boundScrollEls.length = 0
  if (layoutRaf) cancelAnimationFrame(layoutRaf)
})

function selectWholeRowOrColumn(orientation: 'row' | 'column') {
  const e = editor?.value
  if (!e || state.tablePos < 0 || !state.block) return
  const index = orientation === 'row' ? state.rowIndex : state.colIndex
  if (index == null) return
  const map = TableMap.get(state.block)
  const start = orientation === 'row' ? { row: index, col: 0 } : { row: 0, col: index }
  const end =
    orientation === 'row'
      ? { row: index, col: map.width - 1 }
      : { row: map.height - 1, col: index }
  selectCellsByCoords(e, state.tablePos, [start, end], {
    mode: 'dispatch',
    dispatch: e.view.dispatch.bind(e.view),
  })
}

function openRowMenu() {
  selectWholeRowOrColumn('row')
  rowMenuOpen.value = true
  colMenuOpen.value = false
  cellMenuOpen.value = false
}
function openColMenu() {
  selectWholeRowOrColumn('column')
  colMenuOpen.value = true
  rowMenuOpen.value = false
  cellMenuOpen.value = false
}

function addRow() {
  if (suppressExtendClick.row) {
    suppressExtendClick.row = false
    return
  }
  const e = editor?.value
  if (!e || state.tablePos < 0) return
  const table = getTable(e, state.tablePos)
  if (!table) return
  extendRows(e, table.node, state.tablePos, 1)
}
function addColumn() {
  if (suppressExtendClick.column) {
    suppressExtendClick.column = false
    return
  }
  const e = editor?.value
  if (!e || state.tablePos < 0) return
  const table = getTable(e, state.tablePos)
  if (!table) return
  extendColumns(e, table.node, state.tablePos, 1)
}

// ---- selection overlay ----
// 与 my-app 一致：不从缓存/事件推导，而是每次都从当前 DOM 重新取矩形。
const selectionRect = ref<DOMRect | null>(null)

function visibleBounds(el: Element) {
  const wrapper = el.closest('.tableWrapper') as HTMLElement | null
  let left = -Infinity
  let top = -Infinity
  let right = Infinity
  let bottom = Infinity

  if (wrapper) {
    const wr = wrapper.getBoundingClientRect()
    left = Math.max(left, wr.left)
    right = Math.min(right, wr.right)
    top = Math.max(top, wr.top)
    bottom = Math.min(bottom, wr.bottom)
  }

  // 垂直滚动的是编辑器容器；表格向上滚出后，蓝框/把手不能画到标题或工具栏上。
  const scrollEl = el.closest('.notion-like-editor-wrapper') as HTMLElement | null
  if (scrollEl) {
    const sr = scrollEl.getBoundingClientRect()
    left = Math.max(left, sr.left)
    right = Math.min(right, sr.right)
    bottom = Math.min(bottom, sr.bottom)
  }
  const toolbar = document.querySelector('.tiptap-toolbar') as HTMLElement | null
  const toolbarBottom = toolbar ? toolbar.getBoundingClientRect().bottom : -Infinity
  top = Math.max(top, toolbarBottom)

  return { left, top, right, bottom }
}

function visibleInWrapper(el: Element): boolean {
  const r = el.getBoundingClientRect()
  const b = visibleBounds(el)
  return r.right > b.left && r.left < b.right && r.bottom > b.top && r.top < b.bottom
}

function updateSelectionRect() {
  const e = editor?.value
  if (!e) {
    if (selectionRect.value) selectionRect.value = null
    return
  }
  const { selection } = e.state
  const cells: Element[] = []

  if (selection instanceof CellSelection) {
    selection.forEachCell((_node, pos) => {
      const dom = e.view.nodeDOM(pos) as Element | null
      if (dom) cells.push(dom)
    })
  } else if (selection instanceof TextSelection) {
    const at = e.view.domAtPos(selection.from)
    const node = at.node instanceof Element ? at.node : at.node.parentElement
    const cell = node?.closest('td,th')
    if (cell) cells.push(cell)
  }

  // 选中的单元格被滚出表格可视区时，不把 fixed 浮层画到表格外面。
  if (!cells.length || !cells.some(visibleInWrapper)) {
    if (selectionRect.value) selectionRect.value = null
    return
  }

  const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }
  cells.forEach((cell) => {
    const rect = cell.getBoundingClientRect()
    bounds.left = Math.min(bounds.left, rect.left)
    bounds.top = Math.min(bounds.top, rect.top)
    bounds.right = Math.max(bounds.right, rect.right)
    bounds.bottom = Math.max(bounds.bottom, rect.bottom)
  })
  // 多选时可能包含已滚出可视区的单元格：矩形要裁剪到可视区，
  // 否则蓝框会一直延伸到标题/工具栏上方。
  const vis = visibleBounds(cells[0])
  const left = Math.max(bounds.left, vis.left)
  const top = Math.max(bounds.top, vis.top)
  const right = Math.min(bounds.right, vis.right)
  const bottom = Math.min(bounds.bottom, vis.bottom)
  if (right <= left || bottom <= top) {
    if (selectionRect.value) selectionRect.value = null
    return
  }
  const next = new DOMRect(left, top, right - left, bottom - top)
  if (!selectionRect.value || !rectEq(selectionRect.value, next)) {
    selectionRect.value = next
  }
}

const cellMenuStyle = computed(() => {
  const rect = selectionRect.value
  if (!rect) return {}
  return { left: `${rect.right}px`, top: `${rect.top + rect.height / 2}px` }
})

function startResize(handle: 'tl' | 'tr' | 'bl' | 'br', event: PointerEvent) {
  const e = editor?.value
  if (!e) return
  event.preventDefault()
  event.stopPropagation()

  const { selection } = e.state
  if (!(selection instanceof CellSelection)) return

  const anchorMap = { tl: selection.$headCell, tr: selection.$headCell, bl: selection.$anchorCell, br: selection.$anchorCell }
  const anchor = anchorMap[handle]

  const onMove = (ev: PointerEvent) => {
    const el = document.elementFromPoint(ev.clientX, ev.clientY)
    if (!el) return
    const target = el.closest('td,th') as HTMLTableCellElement | null
    if (!target) return
    const pos = e.view.posAtDOM(target, 0)
    const $pos = e.state.doc.resolve(pos)
    for (let d = $pos.depth; d > 0; d--) {
      const node = $pos.node(d)
      if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
        try {
          const sel = CellSelection.create(e.state.doc, anchor.pos, $pos.before(d))
          e.view.dispatch(e.state.tr.setSelection(sel))
        } catch {
          /* ignore transient */
        }
        break
      }
    }
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
}

// ---- extend drag ----
const rowDrag = ref<{ start: number; base: number } | null>(null)
const colDrag = ref<{ start: number; base: number } | null>(null)
const suppressExtendClick = { row: false, column: false }

function applyExtendDelta(orientation: 'row' | 'column', target: number) {
  const e = editor?.value
  if (!e || state.tablePos < 0) return
  const table = getTable(e, state.tablePos)
  if (!table) return
  const current = orientation === 'row' ? table.map.height : table.map.width
  // One step per pointer move keeps the operation predictable and avoids
  // large batch add/remove loops while dragging.
  if (target > current) {
    if (orientation === 'row') extendRows(e, table.node, state.tablePos, 1)
    else extendColumns(e, table.node, state.tablePos, 1)
  } else if (target < current) {
    if (orientation === 'row') extendRows(e, table.node, state.tablePos, -1)
    else extendColumns(e, table.node, state.tablePos, -1)
  }
}

function startExtendDrag(orientation: 'row' | 'column', event: PointerEvent) {
  const e = editor?.value
  if (!e || !state.block) return
  const isRow = orientation === 'row'
  const cellSize = isRow ? extendCellSize.EMPTY_CELL_HEIGHT : extendCellSize.EMPTY_CELL_WIDTH
  const start = isRow ? event.clientY : event.clientX
  const dims = TableMap.get(state.block)
  const base = isRow ? dims.height : dims.width
  let moved = false

  suppressExtendClick[orientation] = false
  if (isRow) rowDrag.value = { start, base }
  else colDrag.value = { start, base }

  const onMove = (ev: PointerEvent) => {
    const current = isRow ? ev.clientY : ev.clientX
    const diff = current - start
    if (!moved && Math.abs(diff) < 8) return
    moved = true
    suppressExtendClick[orientation] = true
    const target = Math.max(1, base + Math.round(diff / cellSize))
    applyExtendDelta(orientation, target)
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
    if (!moved) {
      // 与 my-app 一致：按下不动作，松开才增加一行/列。
      if (isRow) addRow()
      else addColumn()
      suppressExtendClick[orientation] = true
    }
    rowDrag.value = null
    colDrag.value = null
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
}

function startRowDrag(event: PointerEvent) {
  startExtendDrag('row', event)
}

function startColumnDrag(event: PointerEvent) {
  startExtendDrag('column', event)
}

function closeMenus() {
  rowMenuOpen.value = false
  colMenuOpen.value = false
  cellMenuOpen.value = false
}

function onDocMousedown(event: MouseEvent) {
  if (!rowMenuOpen.value && !colMenuOpen.value && !cellMenuOpen.value) return
  const target = event.target
  if (!(target instanceof Element)) return
  // 菜单内部、把手、加号、选区功能按钮不处理，其余区域点击关闭。
  if (
    target.closest(
      '.table-handle-menu-dropdown, .table-handle-floating, .table-extend-btn, .table-cell-menu-btn, .table-selection-overlay, .table-color-flyout',
    )
  ) {
    return
  }
  closeMenus()
}

function toggleCellMenu() {
  if (cellMenuOpen.value) {
    closeMenus()
  } else {
    cellMenuOpen.value = true
    rowMenuOpen.value = false
    colMenuOpen.value = false
  }
}
</script>

<template>
  <div class="table-kit">
    <!-- row/column handles -->
    <div
      v-if="state.show && state.rowIndex != null"
      class="table-handle-floating row"
      :style="rowHandleStyle"
    >
      <button
        type="button"
        class="table-handle-btn"
        :class="{ opened: rowMenuOpen }"
        title="Row actions"
        draggable="true"
        @click="rowMenuOpen ? closeMenus() : openRowMenu()"
        @dragstart="startRowMoveDrag"
        @dragend="onDragEnd"
      >⋮</button>
      <TableHandleMenu
        v-if="rowMenuOpen && editor"
        :editor="editor"
        :index="state.rowIndex"
        orientation="row"
        :table-pos="state.tablePos"
        @close="closeMenus"
      />
    </div>

    <div
      v-if="state.show && state.colIndex != null && showColumnHandle"
      class="table-handle-floating column"
      :style="colHandleStyle"
    >
      <button
        type="button"
        class="table-handle-btn column"
        :class="{ opened: colMenuOpen }"
        title="Column actions"
        draggable="true"
        @click="colMenuOpen ? closeMenus() : openColMenu()"
        @dragstart="startColumnMoveDrag"
        @dragend="onDragEnd"
      >⋯</button>
      <TableHandleMenu
        v-if="colMenuOpen && editor"
        :editor="editor"
        :index="state.colIndex"
        orientation="column"
        :table-pos="state.tablePos"
        @close="closeMenus"
      />
    </div>

    <!-- extend buttons -->
    <button
      v-if="state.show && state.showAddRow"
      type="button"
      class="table-extend-btn row"
      :style="rowExtendStyle"
      title="Add or remove rows"
      @click="addRow"
      @pointerdown="startRowDrag"
    >+</button>
    <button
      v-if="state.show && state.showAddColumn"
      type="button"
      class="table-extend-btn column"
      :style="colExtendStyle"
      title="Add or remove columns"
      @click="addColumn"
      @pointerdown="startColumnDrag"
    >+</button>

    <!-- column width resize handle（整条，不避开行线） -->
    <div
      v-if="state.show && colResizeVisible"
      class="table-col-resize"
      :style="colResizeStyle"
      title="Drag to resize column width; double-click to fit content"
      @pointerdown="startColumnResize"
      @dblclick.stop.prevent="autoFitCurrentColumn"
    />

    <!-- row height resize handle（整条横线，不避开列线） -->
    <div
      v-if="state.show && rowResizeVisible"
      class="table-row-resize"
      :style="rowResizeStyle"
      title="Drag to resize row height; double-click to fit content"
      @pointerdown="startRowResize"
      @dblclick.stop.prevent="fitRowHeight"
    />

    <!-- cell selection overlay -->
    <div
      v-if="selectionRect"
      class="table-selection-overlay"
      :data-cell-menu-open="cellMenuOpen ? 'true' : 'false'"
      :style="{ left: `${selectionRect.left}px`, top: `${selectionRect.top}px`, width: `${selectionRect.width}px`, height: `${selectionRect.height}px` }"
    >
      <button
        type="button"
        class="table-cell-menu-btn"
        :style="cellMenuStyle"
        title="Table cells option"
        @click="toggleCellMenu"
      >+</button>
      <TableCellMenu
        v-if="cellMenuOpen && editor"
        :editor="editor"
        @close="closeMenus"
      />
      <span class="corner tl" @pointerdown="startResize('tl', $event)" />
      <span class="corner tr" @pointerdown="startResize('tr', $event)" />
      <span class="corner bl" @pointerdown="startResize('bl', $event)" />
      <span class="corner br" @pointerdown="startResize('br', $event)" />
    </div>

    <!-- drop cursor while dragging row/column -->
    <div
      v-if="dropIndicator"
      class="table-dropcursor"
      :class="dropIndicator.orientation"
      :style="dropIndicator.orientation === 'row'
        ? { left: `${dropIndicator.left}px`, top: `${dropIndicator.top}px`, width: `${dropIndicator.length}px` }
        : { left: `${dropIndicator.left}px`, top: `${dropIndicator.top}px`, height: `${dropIndicator.length}px` }"
    />
  </div>
</template>

<style scoped>
.table-kit {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 60;
}
.table-handle-floating,
.table-extend-btn,
.table-selection-overlay,
.table-cell-menu-btn,
.corner {
  position: fixed;
  pointer-events: auto;
}
.table-handle-floating {
  display: flex;
  /* transform 会形成 stacking context，需高于选区蓝框(39)，菜单才能压住蓝框 */
  z-index: 50;
}
.table-handle-floating.row {
  transform: translate(-100%, -50%);
}
.table-handle-floating.column {
  transform: translate(-50%, -100%);
}
.table-handle-btn {
  width: 100%;
  height: 100%;
  border: none;
  border-radius: 12px;
  background: var(--tt-table-handle-bg-color, rgba(0, 0, 0, 0.06));
  color: var(--tt-table-extend-icon-color, var(--tt-gray-light-a-400, #9ca3af));
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  padding: 0;
}
.table-handle-btn.column {
  transform: none;
}
.table-handle-btn.opened {
  background: var(--tt-brand-color-500, #6366f1);
  color: #fff;
}
.table-extend-btn {
  border: none;
  border-radius: 12px;
  background: var(--tt-table-handle-bg-color, rgba(0, 0, 0, 0.06));
  color: var(--tt-table-extend-icon-color, var(--tt-gray-light-a-400, #9ca3af));
  font-size: 13px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
}
.table-extend-btn.row {
  cursor: row-resize;
}
.table-extend-btn.column {
  cursor: col-resize;
}
.table-row-resize {
  position: fixed;
  z-index: 45;
  cursor: row-resize;
  pointer-events: auto;
  background: transparent;
}
.table-row-resize:hover {
  background: rgba(129, 140, 248, 0.25);
}
.table-col-resize {
  position: fixed;
  z-index: 44;
  cursor: col-resize;
  pointer-events: auto;
  background: transparent;
}
.table-col-resize:hover {
  background: rgba(129, 140, 248, 0.25);
}
.table-selection-overlay {
  border: 2px solid var(--tt-brand-color-400, #818cf8);
  border-radius: 2px;
  pointer-events: none;
  z-index: 39;
}
.table-cell-menu-btn {
  transform: translate(50%, -50%);
  width: 16px;
  height: 16px;
  border: none;
  border-radius: 50%;
  background: var(--tt-brand-color-600, #4f46e5);
  color: #fff;
  font-size: 10px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.corner {
  position: absolute;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  /* 与 my-app 一致：四角只保留拖拽命中区，不显示圆点 */
  background: transparent;
  pointer-events: auto;
}
.corner.tl { top: -6px; left: -6px; cursor: nwse-resize; }
.corner.tr { top: -6px; right: -6px; cursor: nesw-resize; }
.corner.bl { bottom: -6px; left: -6px; cursor: nesw-resize; }
.corner.br { bottom: -6px; right: -6px; cursor: nwse-resize; }
.table-dropcursor {
  position: fixed;
  z-index: 41;
  background: var(--tt-brand-color-400, #818cf8);
  pointer-events: none;
}
.table-dropcursor.row {
  height: 3px;
  transform: translateY(-50%);
}
.table-dropcursor.column {
  width: 3px;
  transform: translateX(-50%);
}
</style>
