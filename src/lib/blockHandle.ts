import { createApp } from 'vue'
import { offset } from '@floating-ui/dom'
import { DragHandle } from '@tiptap/extension-drag-handle'
import { blockHandleState } from './blockHandleState'
import BlockHandle from '../components/BlockHandle.vue'

/**
 * The Tiptap drag-handle extension. `render()` returns the element the
 * extension positions next to the hovered block; we mount the Vue BlockHandle
 * UI (plus + grip + block menu) into it.
 */
export const BlockHandleExtension = DragHandle.configure({
  render: () => {
    const el = document.createElement('div')
    el.className = 'block-handle-root'
    createApp(BlockHandle).mount(el)
    return el
  },
  computePositionConfig: {
    middleware: [
      offset(({ rects }) => {
        const nodeHeight = rects.reference.height
        const dragHandleHeight = rects.floating.height
        const crossAxis = nodeHeight / 2 - dragHandleHeight / 2
        return {
          mainAxis: 16,
          // Tall blocks (> 40px) stay top-aligned; short blocks are vertically centred.
          crossAxis: nodeHeight > 40 ? 0 : crossAxis,
        }
      }),
    ],
  },
  onNodeChange: ({ node, editor }) => {
    blockHandleState.node = node
    blockHandleState.editor = editor
  },
})
