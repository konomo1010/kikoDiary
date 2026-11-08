<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, shallowRef, watch } from 'vue'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import type { Editor } from '@tiptap/core'
import TopToolbar from './TopToolbar.vue'
import FloatingToolbar from './FloatingToolbar.vue'
import TocSidebar from './TocSidebar.vue'
import EmojiPicker from './EmojiPicker.vue'
import TableHandles from './TableHandles.vue'
import {
  createEditorExtensions,
  insertImageFiles,
} from '../lib/editor'
import { provideEditor } from '../composables/useEditor'
import { TOC_MIN_LAYOUT_WIDTH, tocFits, tocHasItems, tocPosition } from '../composables/useLayout'
import { editorDark, toggleEditorDark } from '../store'

const props = defineProps<{
  modelValue?: object | string | null
  autofocus?: boolean
  toolbarActionsTarget?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [object] }>()

const tocSide = computed(() => tocPosition.value)

/** 只有「有目录项」且「当前宽度放得下」时才为一侧预留列宽 */
const hasToc = computed(() => tocHasItems.value && tocFits.value)

// 目录显隐跟随正文区的实际可用宽度，而不是视口宽度：
// 高 DPI 笔记本缩放到 200%~250% 后，全屏视口往往不足 1280 CSS px，
// 用视口宽度判断会让目录永远不出现。
const layoutEl = ref<HTMLElement | null>(null)
let layoutObserver: ResizeObserver | null = null

function measureLayout(width: number) {
  if (width > 0) tocFits.value = width >= TOC_MIN_LAYOUT_WIDTH
}

onMounted(() => {
  const el = layoutEl.value
  if (!el) return
  measureLayout(el.getBoundingClientRect().width)
  layoutObserver = new ResizeObserver((entries) => {
    measureLayout(entries[0]?.contentRect.width ?? 0)
  })
  layoutObserver.observe(el)

  // Mod+/ 触发 slash 菜单（与 my-app 一致）
  document.addEventListener('keydown', onSlashShortcut)
})

/** Mod+/ 或 Cmd+/：在当前光标位置插入 / 触发 slash 菜单 */
function onSlashShortcut(e: KeyboardEvent) {
  const ed = editor.value
  if (!ed || !ed.isEditable) return
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return
  if (e.key !== '/' && e.key !== '�') return
  e.preventDefault()
  e.stopPropagation()

  const { $from } = ed.state.selection
  const currentNode = $from.node()
  const isEmpty = currentNode.textContent.length === 0
  const isStartOfBlock = $from.parentOffset === 0

  if (isEmpty && isStartOfBlock) {
    ed.chain().focus().insertContent({ type: 'text', text: '/' }).run()
  } else {
    ed.chain()
      .focus()
      .insertContentAt($from.after(), {
        type: 'paragraph',
        content: [{ type: 'text', text: '/' }],
      })
      .run()
  }
}

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
      // 程序化同步正文不是用户编辑，不能进入撤销历史。
      // 仅设置 emitUpdate: false 仍会让首次 Undo 把载入内容整篇清空。
      ed.chain()
        .command(({ tr }) => {
          tr.setMeta('addToHistory', false)
          return true
        })
        .setContent(val ?? '', { emitUpdate: false })
        .run()
    }
  }
)

provideEditor(editor)

// Emoji picker 状态
const emojiOpen = ref(false)
function onOpenEmojiPicker() {
  emojiOpen.value = true
}
function onPickEmoji(e: string) {
  const ed = editor.value
  if (ed) ed.chain().focus().insertContent(e).run()
  emojiOpen.value = false
}
function onCloseEmojiPicker() {
  emojiOpen.value = false
}

onMounted(() => {
  window.addEventListener('kiko:open-emoji-picker', onOpenEmojiPicker)
})

onBeforeUnmount(() => {
  layoutObserver?.disconnect()
  layoutObserver = null
  document.removeEventListener('keydown', onSlashShortcut)
  window.removeEventListener('kiko:open-emoji-picker', onOpenEmojiPicker)
  editor.value?.destroy()
})
</script>

<template>
  <div class="notion-like-editor-wrapper" :data-tt-theme="editorDark ? 'dark' : 'light'">
    <TopToolbar :actions-target="toolbarActionsTarget" />
    <div ref="layoutEl" class="notion-like-editor-layout" :class="[`toc-${tocSide}`, { 'has-toc': hasToc }]">
      <div class="notion-like-editor-content">
        <EditorContent :editor="editor" />
      </div>
      <TocSidebar />
    </div>
    <FloatingToolbar />
    <div class="table-handles-wrapper">
      <TableHandles />
    </div>
    <EmojiPicker :open="emojiOpen" @select="onPickEmoji" @close="onCloseEmojiPicker" />
  </div>
</template>
