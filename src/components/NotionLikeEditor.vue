<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, shallowRef, watch } from 'vue'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import type { Editor } from '@tiptap/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { NodeSelection } from '@tiptap/pm/state'
import { SearchHighlight, setSearchKeyword } from '../lib/searchHighlight'
import TopToolbar from './TopToolbar.vue'
import FloatingToolbar from './FloatingToolbar.vue'
import TocSidebar from './TocSidebar.vue'
import EmojiPicker from './EmojiPicker.vue'
import ImageViewer from './ImageViewer.vue'
import TableHandles from './TableHandles.vue'
import {
  createEditorExtensions,
  insertImageFiles,
} from '../lib/editor'
import { provideEditor } from '../composables/useEditor'
import { TOC_MIN_LAYOUT_WIDTH, tocFits, tocHasItems, tocPosition } from '../composables/useLayout'
import { editorDark, state, toggleEditorDark } from '../store'

const props = defineProps<{
  modelValue?: object | string | null
  autofocus?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [object] }>()

const tocSide = computed(() => tocPosition.value)

/** 只有「有目录项」且「当前宽度放得下」时才为一侧预留列宽 */
const hasToc = computed(() => tocHasItems.value && tocFits.value)

// 目录显隐跟随正文区的实际可用宽度，而不是视口宽度：
// 高 DPI 笔记本缩放到 200%~250% 后，全屏视口往往不足 1280 CSS px，
// 用视口宽度判断会让目录永远不出现。
const layoutEl = ref<HTMLElement | null>(null)
const wrapperEl = ref<HTMLElement | null>(null)
const viewerOpen = ref(false)
const viewerSrc = ref('')
const viewerAlt = ref('')
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
  document.addEventListener('click', onLinkClick, true)
  document.addEventListener('dblclick', onImageDblClick, true)
  document.addEventListener('copy', onCopyImage, true)
  document.addEventListener('keydown', onCopyImageKey, true)
  document.addEventListener('keydown', onModifierKey, true)
  document.addEventListener('keyup', onModifierKey, true)
  window.addEventListener('blur', onWindowBlur)
})

/** Ctrl/Cmd + 点击正文链接：用系统浏览器打开；普通点击只编辑，不导航 */
function onLinkClick(e: MouseEvent) {
  const target = e.target
  if (!(target instanceof Element)) return
  const link = target.closest('a[href]')
  if (!link || !link.closest('.tiptap.ProseMirror')) return
  const href = link.getAttribute('href')
  if (!href) return
  // 普通点击不跳转，但保留编辑器的光标/选区处理
  if (!(e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    return
  }
  e.preventDefault()
  e.stopPropagation()
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
  if (isTauri) openUrl(href).catch((err) => console.error('[editor] open link failed', err))
  else window.open(href, '_blank', 'noopener')
}

/** 按住 Ctrl/Cmd 时让正文链接显示手型光标，松开恢复 */
function setLinkModifier(held: boolean) {
  wrapperEl.value?.classList.toggle('link-modifier', held)
}

function onModifierKey(e: KeyboardEvent) {
  if (e.key === 'Control' || e.key === 'Meta') setLinkModifier(e.type === 'keydown')
}

function onWindowBlur() {
  setLinkModifier(false)
}

/** 在光标处插入图片节点（块级节点交给 insertContent 处理段落拆分） */
function insertImageAttrs(attrs, view) {
  const ed = editorRef.value
  if (ed) {
    ed.chain().focus().insertContent({ type: 'image', attrs }).run()
    return
  }
  const node = view.state.schema.nodes.image.create(attrs)
  view.dispatch(view.state.tr.replaceSelectionWith(node))
}

/** Ctrl/Cmd+C：图片节点选区直接写入系统剪贴板，避免原生复制链路吞掉 */
async function onCopyImageKey(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return
  if (String(event.key || '').toLowerCase() !== 'c') return
  const ed = editor.value
  if (!ed) return
  const selection = ed.state.selection
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'image') return
  const attrs = selection.node.attrs
  const img = document.createElement('img')
  img.setAttribute('src', attrs.src || '')
  img.setAttribute('alt', attrs.alt || '')
  img.setAttribute('data-kiko-image', '1')
  if (attrs.width) img.setAttribute('width', String(attrs.width))
  if (attrs['data-align']) img.setAttribute('data-align', attrs['data-align'])
  event.preventDefault()
  event.stopPropagation()
  try {
    const data = {
      'text/html': new Blob([img.outerHTML], { type: 'text/html' }),
      'text/plain': new Blob([attrs.src || ''], { type: 'text/plain' }),
    }
    await navigator.clipboard.write([new ClipboardItem(data)])
  } catch (e) {
    console.warn('[editor] copy image to clipboard failed', e)
  }
}

/** 复制图片节点：写入专用剪贴板格式 + 标准 HTML，保证粘贴时能还原为图片 */
function onCopyImage(event: ClipboardEvent) {
  const ed = editor.value
  if (!ed || !event.clipboardData) return
  const selection = ed.state.selection
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'image') return
  const attrs = selection.node.attrs
  event.preventDefault()
  event.clipboardData.setData('application/x-kiko-image', JSON.stringify(attrs))
  // 标准 HTML 格式兼容系统剪贴板；自定义 MIME 可能被系统丢弃
  const img = document.createElement('img')
  img.setAttribute('src', attrs.src || '')
  img.setAttribute('alt', attrs.alt || '')
  img.setAttribute('data-kiko-image', '1')
  if (attrs.width) img.setAttribute('width', String(attrs.width))
  if (attrs['data-align']) img.setAttribute('data-align', attrs['data-align'])
  event.clipboardData.setData('text/html', img.outerHTML)
  event.clipboardData.setData('text/plain', attrs.src || '')
}

/** 双击正文图片：打开全屏图片查看器 */
function onImageDblClick(e: MouseEvent) {
  const target = e.target
  if (!(target instanceof HTMLImageElement)) return
  if (!target.closest('.tiptap.ProseMirror')) return
  e.preventDefault()
  viewerSrc.value = target.currentSrc || target.src
  viewerAlt.value = target.alt || ''
  viewerOpen.value = true
}

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
  extensions: [...createEditorExtensions(), SearchHighlight],
  editorProps: {
    attributes: { class: 'notion-like-editor' },
    handlePaste: (_view, event) => {
      const clipboard = event.clipboardData
      if (!clipboard) return false
      // 编辑器内复制的图片：按节点属性还原，兼容 WebView 的默认图片复制
      const custom = clipboard.getData('application/x-kiko-image')
      if (custom) {
        try {
          insertImageAttrs(JSON.parse(custom), _view)
          return true
        } catch (e) {
          console.warn('[editor] paste image node failed', e)
        }
      }
      // 系统剪贴板可能清洗自定义属性，HTML 里只要有 img 就按图片还原
      const html = clipboard.getData('text/html')
      if (html && /<img\b/i.test(html)) {
        try {
          const doc = new DOMParser().parseFromString(html, 'text/html')
          const img = doc.querySelector('img[src]')
          if (img) {
            const width = Number(img.getAttribute('width'))
            insertImageAttrs({
              src: img.getAttribute('src') || '',
              alt: img.getAttribute('alt') || '',
              width: Number.isFinite(width) && width > 0 ? width : null,
              'data-align': img.getAttribute('data-align') || 'center',
            }, _view)
            return true
          }
        } catch (e) {
          console.warn('[editor] paste image html failed', e)
        }
      }
      // Excel/网页复制时常同时带图片文件，有文本或 HTML 时优先按文本粘贴
      if (clipboard.types.includes('text/html') || clipboard.types.includes('text/plain')) return false
      const files = clipboard.files
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
    handleKeyDown: (view, event) => {
      if (event.key !== 'Tab') return false
      const { state } = view
      const { from, to, $from } = state.selection
      if ($from.parent.type.name !== 'codeBlock') return false
      event.preventDefault()

      // 空光标：直接插入两空格
      if (from === to) {
        view.dispatch(state.tr.insertText('  ', from))
        return true
      }

      const start = $from.start()
      const end = $from.end()
      const text = state.doc.textBetween(start, end, '\n')
      const localFrom = Math.max(0, from - start)
      const localTo = Math.max(localFrom, to - start)

      // 找到与选区相交的每一行
      const lineStarts = [0]
      for (let i = 0; i < text.length; i++) {
        if (text[i] === '\n') lineStarts.push(i + 1)
      }
      const targets = lineStarts.filter((s) => {
        const nl = text.indexOf('\n', s)
        const lineEnd = nl === -1 ? text.length : nl
        return s <= localTo && lineEnd >= localFrom
      })

      if (event.shiftKey) {
        // Shift+Tab：删除行首最多两个空格
        const tr = state.tr
        for (const s of [...targets].reverse()) {
          const nl = text.indexOf('\n', s)
          const lineEnd = nl === -1 ? text.length : nl
          const spaces = /^ */.exec(text.slice(s, lineEnd))[0].length
          const remove = Math.min(2, spaces)
          if (remove > 0) tr.delete(start + s, start + s + remove)
        }
        view.dispatch(tr)
        return true
      }

      // Tab：在每一行行首插入两个空格，保留原选中内容
      const tr = state.tr
      for (const s of [...targets].reverse()) {
        tr.insert(start + s, state.schema.text('  '))
      }
      view.dispatch(tr)
      return true
    },
  },
  onUpdate: ({ editor: ed }) => {
    emit('update:modelValue', ed.getJSON())
    scheduleHighlight()
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
      // 正文被整体替换（切换日记）时，让锚定在旧正文上的浮层（表格把手等）收起
      window.dispatchEvent(new CustomEvent('kiko:doc-replaced'))
      scheduleHighlight()
    }
  }
)

provideEditor(editor)

/* ---- 搜索关键词正文高亮（ProseMirror Decoration，不改文档数据） ---- */
let highlightRaf = 0
function applyHighlights() {
  setSearchKeyword(editor.value, state.search.trim())
}
function scheduleHighlight() {
  if (highlightRaf) cancelAnimationFrame(highlightRaf)
  highlightRaf = requestAnimationFrame(applyHighlights)
}

watch(() => state.search, scheduleHighlight)
watch(editor, (ed) => { if (ed) scheduleHighlight() })

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
  document.removeEventListener('click', onLinkClick, true)
  document.removeEventListener('dblclick', onImageDblClick, true)
  document.removeEventListener('copy', onCopyImage, true)
  document.removeEventListener('keydown', onCopyImageKey, true)
  document.removeEventListener('keydown', onModifierKey, true)
  document.removeEventListener('keyup', onModifierKey, true)
  window.removeEventListener('blur', onWindowBlur)
  window.removeEventListener('kiko:open-emoji-picker', onOpenEmojiPicker)
  if (highlightRaf) cancelAnimationFrame(highlightRaf)
  editor.value?.destroy()
})
</script>

<template>
  <div ref="wrapperEl" class="notion-like-editor-wrapper" :data-tt-theme="editorDark ? 'dark' : 'light'">
    <TopToolbar />
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
    <ImageViewer :open="viewerOpen" :src="viewerSrc" :alt="viewerAlt" @close="viewerOpen = false" />
  </div>
</template>
