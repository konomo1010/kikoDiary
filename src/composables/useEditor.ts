import {
  inject,
  onBeforeUnmount,
  provide,
  ref,
  watch,
  type InjectionKey,
  type ShallowRef,
} from 'vue'
import type { Editor } from '@tiptap/core'

const EditorKey: InjectionKey<ShallowRef<Editor | undefined>> =
  Symbol('tiptap-editor')

export function provideEditor(editor: ShallowRef<Editor | undefined>) {
  provide(EditorKey, editor)
}

export function injectEditor() {
  return inject(EditorKey)
}

/**
 * Bumps a counter on every editor transaction / selection change, so that
 * `computed`/template functions reading `editor.isActive()` re-evaluate.
 */
export function useEditorTick(
  editor: ShallowRef<Editor | undefined> | undefined
) {
  const tick = ref(0)
  const bump = () => {
    tick.value += 1
  }

  watch(
    () => editor?.value,
    (next, prev) => {
      prev?.off('transaction', bump)
      prev?.off('selectionUpdate', bump)
      next?.on('transaction', bump)
      next?.on('selectionUpdate', bump)
      bump()
    },
    { immediate: true }
  )

  onBeforeUnmount(() => {
    editor?.value?.off('transaction', bump)
    editor?.value?.off('selectionUpdate', bump)
  })

  return tick
}
