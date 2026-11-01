<script setup lang="ts">
import { computed, onBeforeUnmount, provide, ref, shallowRef, watch } from 'vue'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import type { Editor } from '@tiptap/core'
import TopToolbar from './TopToolbar.vue'
import FloatingToolbar from './FloatingToolbar.vue'
import TocSidebar from './TocSidebar.vue'
import {
  createEditorExtensions,
  insertImageFiles,
} from '../lib/editor'
import { provideEditor } from '../composables/useEditor'
import { tocPosition } from '../composables/useLayout'
import { editorDark, toggleEditorDark } from '../store'

const props = defineProps<{
  modelValue?: object | string | null
  autofocus?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [object] }>()

const tocSide = computed(() => tocPosition.value)

// Editor-local dark mode state lives in the store so the editor footer can follow it too.
provide('editorDark', editorDark)
provide('toggleEditorDark', toggleEditorDark)

const editorRef = shallowRef<Editor | null>(null)

const editor = useEditor({
  content: props.modelValue ?? '',
  autofocus: props.autofocus ?? false,
  extensions: createEditorExtensions(),
  editorProps: {
    attributes: { class: 'notion-like-editor' },
    handlePaste: (_view, event) => {
      const files = event.clipboardData?.files
      if (!files || files.length === 0) return false
      const inserted = insertImageFiles(editorRef.value, files)
      if (inserted) event.preventDefault()
      return inserted
    },
    handleDrop: (_view, event) => {
      const files = event.dataTransfer?.files
      if (!files || files.length === 0) return false
      const inserted = insertImageFiles(editorRef.value, files)
      if (inserted) event.preventDefault()
      return inserted
    },
  },
  onUpdate: ({ editor: ed }) => {
    emit('update:modelValue', ed.getJSON())
  },
})

watch(
  editor,
  (val) => {
    editorRef.value = val ?? null
  },
  { immediate: true }
)

watch(
  () => props.modelValue,
  (val) => {
    const ed = editor.value
    if (!ed) return
    const incoming = JSON.stringify(val ?? null)
    const current = JSON.stringify(ed.getJSON())
    if (incoming !== current) {
      ed.commands.setContent(val ?? '', { emitUpdate: false })
    }
  }
)

provideEditor(editor)

onBeforeUnmount(() => {
  editor.value?.destroy()
})
</script>

<template>
  <div class="notion-like-editor-wrapper" :data-tt-theme="editorDark ? 'dark' : 'light'">
    <TopToolbar />
    <div class="notion-like-editor-layout" :class="`toc-${tocSide}`">
      <div class="notion-like-editor-content">
        <EditorContent :editor="editor" />
      </div>
      <TocSidebar />
    </div>
    <FloatingToolbar />
  </div>
</template>
