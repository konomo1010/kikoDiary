import { Extension, findParentNodeClosestToPos } from '@tiptap/core'
import type { NodeWithPos } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import {
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  type EditorState,
  type Transaction,
} from '@tiptap/pm/state'
import { cellAround, CellSelection } from '@tiptap/pm/tables'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    indent: {
      indent: () => ReturnType
      outdent: () => ReturnType
      setIndent: (level: number) => ReturnType
      unsetIndent: () => ReturnType
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

function getSelectedNodesOfType(
  selection: Selection,
  allowedNodeTypes: string[]
): NodeWithPos[] {
  const results: NodeWithPos[] = []
  const allowed = new Set(allowedNodeTypes)

  if (selection instanceof CellSelection) {
    selection.forEachCell((node: PMNode, pos: number) => {
      if (allowed.has(node.type.name)) {
        results.push({ node, pos })
      }
    })
    return results
  }

  if (selection instanceof NodeSelection) {
    const { node, from: pos } = selection
    if (node && allowed.has(node.type.name)) {
      results.push({ node, pos })
    }
    return results
  }

  const { $anchor } = selection
  const cell = cellAround($anchor)

  if (cell) {
    const cellNode = selection.$anchor.doc.nodeAt(cell.pos)
    if (cellNode && allowed.has(cellNode.type.name)) {
      results.push({ node: cellNode, pos: cell.pos })
      return results
    }
  }

  const parentNode = findParentNodeClosestToPos($anchor, (node) =>
    allowed.has(node.type.name)
  )

  if (parentNode) {
    results.push({ node: parentNode.node, pos: parentNode.pos })
  }

  return results
}

function updateNodesAttr(
  tr: Transaction,
  targets: readonly NodeWithPos[],
  attrName: string,
  next: unknown | ((prev: unknown) => unknown)
): boolean {
  if (!targets.length) return false

  let changed = false

  for (const { pos } of targets) {
    const currentNode = tr.doc.nodeAt(pos)
    if (!currentNode) continue

    const prevValue = (currentNode.attrs as Record<string, unknown>)[attrName]
    const resolvedNext =
      typeof next === 'function'
        ? (next as (p: unknown) => unknown)(prevValue)
        : next

    if (prevValue === resolvedNext) continue

    const nextAttrs: Record<string, unknown> = { ...currentNode.attrs }
    if (resolvedNext === undefined) {
      delete nextAttrs[attrName]
    } else {
      nextAttrs[attrName] = resolvedNext
    }

    tr.setNodeMarkup(pos, undefined, nextAttrs)
    changed = true
  }

  return changed
}

export interface IndentOptions {
  types: string[]
  listItemTypes: string[]
  bypassAncestors: string[]
  minLevel: number
  maxLevel: number
  useStyle?: boolean
  indentUnit: number
}

function parseIndentLevel(
  element: HTMLElement,
  minLevel: number,
  maxLevel: number,
  indentUnit: number
): number {
  const dataIndent = element.getAttribute('data-indent')
  if (dataIndent) {
    const level = parseInt(dataIndent, 10)
    if (!isNaN(level)) return clamp(level, minLevel, maxLevel)
  }

  const cssProps = ['marginLeft', 'paddingLeft', 'textIndent'] as const
  for (const prop of cssProps) {
    const value = element.style?.[prop]
    if (value) {
      const px = parseFloat(value)
      if (!isNaN(px) && px > 0 && indentUnit > 0) {
        return clamp(Math.round(px / indentUnit), minLevel, maxLevel)
      }
    }
  }

  return 0
}

function getListItemName(
  state: EditorState,
  listItemTypes: Set<string>
): string | null {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    const name = $from.node(depth).type.name
    if (listItemTypes.has(name)) return name
  }
  return null
}

function shouldOutdentAtCursor(
  state: EditorState,
  types: string[],
  listItemTypes: Set<string>,
  options: { onlyIfEmpty: boolean }
): boolean {
  const { selection } = state
  const { $from } = selection

  if (!selection.empty) return false
  if (getListItemName(state, listItemTypes) !== null) return false

  const parent = $from.parent
  if (!types.includes(parent.type.name)) return false
  if ((parent.attrs.indent as number) <= 0) return false

  if (options.onlyIfEmpty) {
    return parent.content.size === 0
  }
  return $from.parentOffset === 0
}

const indentPluginKey = new PluginKey('indent')

export const Indent = Extension.create<IndentOptions>({
  name: 'indent',

  addOptions() {
    return {
      types: ['paragraph', 'heading', 'blockquote'],
      listItemTypes: ['listItem', 'taskItem'],
      bypassAncestors: ['tableCell', 'tableHeader'],
      minLevel: 0,
      maxLevel: 8,
      useStyle: false,
      indentUnit: 24,
    }
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element) =>
              parseIndentLevel(
                element,
                this.options.minLevel,
                this.options.maxLevel,
                this.options.indentUnit
              ),
            renderHTML: (attributes) => {
              const level = Number(attributes.indent) || 0
              if (level === 0) return {}

              const attrs: Record<string, string> = {
                'data-indent': String(level),
                style: `--tt-indent-level: ${level}`,
              }
              if (this.options.useStyle && this.options.indentUnit > 0) {
                attrs.style = `--tt-indent-level: ${level}; margin-left: ${level * this.options.indentUnit}px`
              }
              return attrs
            },
          },
        },
      },
    ]
  },

  addCommands() {
    const listItemTypesSet = new Set(this.options.listItemTypes)

    const applyIndent = (
      { state, tr }: { state: EditorState; tr: Transaction },
      resolve: (currentLevel: number) => number
    ) => {
      const targets = getSelectedNodesOfType(state.selection, this.options.types)
      if (targets.length === 0) return false

      return updateNodesAttr(tr, targets, 'indent', (prev) =>
        clamp(
          resolve(Number(prev) || 0),
          this.options.minLevel,
          this.options.maxLevel
        )
      )
    }

    return {
      indent:
        () =>
        (props) => {
          const listItemName = getListItemName(props.state, listItemTypesSet)
          if (listItemName && 'sinkListItem' in props.commands) {
            return props.commands.sinkListItem(listItemName)
          }
          return applyIndent(props, (current) => current + 1)
        },

      outdent:
        () =>
        (props) => {
          const listItemName = getListItemName(props.state, listItemTypesSet)
          if (listItemName && 'liftListItem' in props.commands) {
            return props.commands.liftListItem(listItemName)
          }
          return applyIndent(props, (current) => current - 1)
        },

      setIndent:
        (level: number) =>
        (props) =>
          applyIndent(props, () => level),

      unsetIndent:
        () =>
        (props) =>
          applyIndent(props, () => 0),
    }
  },

  addProseMirrorPlugins() {
    const types = this.options.types

    return [
      new Plugin({
        key: indentPluginKey,
        appendTransaction(transactions, _oldState, newState) {
          const isDrop = transactions.some(
            (tr) => tr.getMeta('uiEvent') === 'drop'
          )
          if (!isDrop) return null

          const { doc, selection } = newState
          const { $from, $to } = selection

          const depth = $from.depth > 0 ? $from.depth : 1
          const dropBlockStart = $from.before(depth)
          const $drop = doc.resolve(dropBlockStart)
          const parent = $drop.node($drop.depth)
          const index = $drop.index($drop.depth)

          let targetIndent = 0
          if (index > 0) {
            targetIndent = (parent.child(index - 1).attrs.indent as number) || 0
          } else {
            const endDepth = $to.depth > 0 ? $to.depth : 1
            const dropBlockEnd = $to.after(endDepth)
            const $afterDrop = doc.resolve(dropBlockEnd)
            const afterIndex = $afterDrop.indexAfter($afterDrop.depth)
            const afterParent = $afterDrop.node($afterDrop.depth)
            if (afterIndex < afterParent.childCount) {
              targetIndent =
                (afterParent.child(afterIndex).attrs.indent as number) || 0
            }
          }

          const { tr } = newState
          let changed = false

          doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
            if (!types.includes(node.type.name)) return false
            const currentIndent = (node.attrs.indent as number) || 0
            if (currentIndent === targetIndent) return false
            tr.setNodeMarkup(
              pos,
              undefined,
              { ...node.attrs, indent: targetIndent },
              node.marks
            )
            changed = true
            return false
          })

          return changed ? tr : null
        },
      }),
    ]
  },

  addKeyboardShortcuts() {
    const listItemTypesSet = new Set(this.options.listItemTypes)
    const bypassAncestorsSet = new Set(this.options.bypassAncestors)

    const isInsideBypassAncestor = (state: EditorState): boolean => {
      if (bypassAncestorsSet.size === 0) return false
      const { $from } = state.selection
      for (let depth = $from.depth; depth > 0; depth--) {
        if (bypassAncestorsSet.has($from.node(depth).type.name)) return true
      }
      return false
    }

    const isIndentableContext = (): boolean => {
      const state = this.editor.state
      if (isInsideBypassAncestor(state)) return false
      if (getListItemName(state, listItemTypesSet) !== null) return true
      const { $from } = state.selection
      return this.options.types.includes($from.parent.type.name)
    }

    return {
      Tab: () => {
        if (!isIndentableContext()) return false
        this.editor.commands.indent()
        return true
      },
      'Shift-Tab': () => {
        if (!isIndentableContext()) return false
        this.editor.commands.outdent()
        return true
      },
      Enter: ({ editor }) => {
        if (
          !shouldOutdentAtCursor(editor.state, this.options.types, listItemTypesSet, {
            onlyIfEmpty: true,
          })
        ) {
          return false
        }
        return editor.commands.outdent()
      },
      Backspace: ({ editor }) => {
        if (
          !shouldOutdentAtCursor(editor.state, this.options.types, listItemTypesSet, {
            onlyIfEmpty: false,
          })
        ) {
          return false
        }
        return editor.commands.outdent()
      },
    }
  },
})

export default Indent
