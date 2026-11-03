import { shallowReactive } from 'vue'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Editor } from '@tiptap/core'

/**
 * Shared state between the drag-handle extension and the BlockHandle.vue UI.
 * Kept in its own module to avoid a circular import (extension ← component).
 *
 * `shallowReactive` avoids wrapping the ProseMirror node / editor in Proxies,
 * which would break `child === node` identity checks. We also keep the last
 * valid `pos` and never clear it on `node: null`, so a click that races with
 * the drag-handle's mouseleave (when the pointer crosses the gap between the
 * editor and the handle) still has a valid position to act on.
 */
export const blockHandleState = shallowReactive<{
  node: PMNode | null
  editor: Editor | null
  pos: number
}>({
  node: null,
  editor: null,
  pos: -1,
})
