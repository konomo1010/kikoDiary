import { reactive } from 'vue'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Editor } from '@tiptap/core'

/**
 * Shared state between the drag-handle extension and the BlockHandle.vue UI.
 * Kept in its own module to avoid a circular import (extension ← component).
 */
export const blockHandleState = reactive<{
  node: PMNode | null
  editor: Editor | null
}>({
  node: null,
  editor: null,
})
