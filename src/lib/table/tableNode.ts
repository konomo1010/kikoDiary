import { Extension, getRenderedAttributes } from '@tiptap/core'
import type { Node as TiptapNode } from '@tiptap/core'
import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
  type TableOptions,
  type TableCellOptions,
} from '@tiptap/extension-table'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { ViewMutationRecord } from '@tiptap/pm/view'
import type { Command as PMCommand } from '@tiptap/pm/state'
import { EditorState, Selection, TextSelection } from '@tiptap/pm/state'
import {
  addColumnAfter,
  addColumnBefore,
  cellAround,
  mergeCells,
  splitCell,
  tableEditing,
  TableView,
} from '@tiptap/pm/tables'
import { EMPTY_CELL_WIDTH } from './tableUtils'

/**
 * prosemirror-tables' addColumn/merge/split map positions through the full
 * transaction mapping. In a chained Tiptap command the transaction may already
 * contain steps, corrupting the table. Re-run the command on a snapshot so its
 * steps replay onto the shared transaction unchanged.
 */
function chainSafe(command: PMCommand) {
  return ({ state, tr, dispatch }: { state: EditorState; tr: any; dispatch?: (tr: any) => void }) => {
    if (!dispatch) return command(state, undefined)

    const snapshot = EditorState.create({ doc: tr.doc, selection: tr.selection })
    return command(snapshot, (result: any) => {
      for (const step of result.steps) tr.step(step)
      if (result.selectionSet) tr.setSelection(Selection.fromJSON(tr.doc, result.selection.toJSON()))
    })
  }
}

function extendTableNode(baseTable: TiptapNode<TableOptions>) {
  return baseTable.extend<TableOptions>({
    addCommands() {
      return {
        ...(this.parent?.() ?? {}),
        addColumnBefore: () => chainSafe(addColumnBefore),
        addColumnAfter: () => chainSafe(addColumnAfter),
        mergeCells: () => chainSafe(mergeCells),
        splitCell: () => chainSafe(splitCell),
        mergeOrSplit: () => chainSafe((state, dispatch) => mergeCells(state, dispatch) || splitCell(state, dispatch)),
      }
    },

    addProseMirrorPlugins() {
      return [
        tableEditing({ allowTableNodeSelection: this.options.allowTableNodeSelection }),
      ]
    },

    addNodeView() {
      return ({ node, HTMLAttributes, editor }) => {
        class TiptapTableView extends TableView {
          private blockContainer: HTMLDivElement
          private innerTableContainer: HTMLDivElement
          private widgetsContainer: HTMLDivElement
          private overlayContainer: HTMLDivElement
          declare readonly node: PMNode
          declare readonly minCellWidth: number
          private containerAttributes: Record<string, string>

          constructor(node: PMNode, minCellWidth: number, containerAttributes: Record<string, string>) {
            super(node, minCellWidth)
            this.containerAttributes = containerAttributes ?? {}

            this.blockContainer = this.createBlockContainer()
            this.innerTableContainer = document.createElement('div')
            this.innerTableContainer.className = 'table-container'
            this.widgetsContainer = document.createElement('div')
            this.widgetsContainer.className = 'table-controls'
            this.widgetsContainer.style.position = 'relative'
            this.overlayContainer = document.createElement('div')
            this.overlayContainer.className = 'table-selection-overlay-container'

            this.setupDOMStructure()
          }

          private createBlockContainer(): HTMLDivElement {
            const container = document.createElement('div')
            container.setAttribute('data-content-type', 'table')
            this.applyContainerAttributes(container)
            return container
          }

          private applyContainerAttributes(element: HTMLDivElement): void {
            Object.entries(this.containerAttributes).forEach(([key, value]) => {
              if (key !== 'class' && value != null) element.setAttribute(key, value)
            })
          }

          private syncContainerAttributes(node: PMNode): void {
            if (node.attrs === this.node.attrs) return
            const nextAttributes: Record<string, string> = getRenderedAttributes(node, editor.extensionManager.attributes)
            Object.keys(this.containerAttributes).forEach((key) => {
              if (key !== 'class' && nextAttributes[key] == null) {
                this.blockContainer.removeAttribute(key)
              }
            })
            this.containerAttributes = nextAttributes
            this.applyContainerAttributes(this.blockContainer)
          }

          private setupDOMStructure(): void {
            const originalTable = this.dom
            const tableElement = originalTable.firstChild as HTMLElement
            this.innerTableContainer.appendChild(tableElement)
            originalTable.appendChild(this.innerTableContainer)
            originalTable.appendChild(this.widgetsContainer)
            originalTable.appendChild(this.overlayContainer)
            this.blockContainer.appendChild(originalTable)
            this.dom = this.blockContainer
          }

          update(node: PMNode): boolean {
            if (node.type !== this.node.type) return false
            this.syncContainerAttributes(node)
            return super.update(node)
          }

          ignoreMutation(mutation: ViewMutationRecord): boolean {
            const isInsideTable = this.table.contains(mutation.target)
            return !isInsideTable || super.ignoreMutation(mutation)
          }

          stopEvent(event: Event): boolean {
            const target = event.target
            if (!(target instanceof Node)) return false
            return this.widgetsContainer.contains(target) || this.overlayContainer.contains(target)
          }
        }

        const cellMinWidth =
          this.options.cellMinWidth < EMPTY_CELL_WIDTH ? EMPTY_CELL_WIDTH : this.options.cellMinWidth
        return new TiptapTableView(node, cellMinWidth, HTMLAttributes)
      }
    },
  })
}

function extendTableCellNode(baseTableCell: TiptapNode<TableCellOptions>) {
  return baseTableCell.extend<TableCellOptions>({
    addKeyboardShortcuts() {
      return {
        ...(this.parent?.() ?? {}),
        'Mod-a': () => {
          const { state, view } = this.editor
          const { selection, doc } = state
          const $anchor = selection.$anchor
          const cellPos = cellAround($anchor)
          if (!cellPos) return false

          const cellNode = doc.nodeAt(cellPos.pos)
          if (!cellNode || !cellNode.textContent) return false

          const from = cellPos.pos + 1
          const to = cellPos.pos + cellNode.nodeSize - 1
          if (from >= to) return true

          const $from = doc.resolve(from)
          const $to = doc.resolve(to)
          const nextSel = TextSelection.between($from, $to, 1)
          if (!nextSel || state.selection.eq(nextSel)) return true

          view.dispatch(state.tr.setSelection(nextSel))
          return true
        },
      }
    },
  })
}

export const TableNode = extendTableNode(Table)
export const TableCellNode = extendTableCellNode(TableCell)
export const TableHeaderNode = TableHeader
export const TableRowNode = TableRow.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      // 行高（px），null 表示随内容自适应
      rowHeight: {
        default: null,
        parseHTML: (element) => {
          const raw = element.getAttribute('data-row-height') || element.style.height
          if (!raw) return null
          const value = Number.parseFloat(raw)
          return Number.isFinite(value) ? value : null
        },
        renderHTML: (attributes) => {
          if (!attributes.rowHeight) return {}
          return {
            'data-row-height': String(attributes.rowHeight),
            style: `height: ${attributes.rowHeight}px; --kiko-row-height: ${attributes.rowHeight}px`,
          }
        },
      },
    }
  },
})

export const TableKit = Extension.create({
  name: 'tableKit',
})
