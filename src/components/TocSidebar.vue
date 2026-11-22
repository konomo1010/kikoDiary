<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { injectEditor } from '../composables/useEditor'
import { tocFits, tocHasItems } from '../composables/useLayout'

interface HeadingItem {
  level: number
  text: string
  pos: number
}

const editor = injectEditor()
const headings = ref<HeadingItem[]>([])

function updateToc() {
  const e = editor?.value
  if (!e) return
  const result: HeadingItem[] = []
  e.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      result.push({
        level: Number(node.attrs.level) || 1,
        text: node.textContent || 'Untitled',
        pos,
      })
    }
    return true
  })
  headings.value = result
  tocHasItems.value = result.length > 0
}

function onTransaction({ transaction }: { transaction: { docChanged: boolean } }) {
  if (transaction.docChanged) updateToc()
}

watch(
  () => editor?.value,
  (next, prev) => {
    prev?.off('transaction', onTransaction)
    next?.on('transaction', onTransaction)
    updateToc()
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  editor?.value?.off('transaction', onTransaction)
  // 编辑器卸载时清掉，避免下一篇日记沿用上一份的「有目录」状态
  tocHasItems.value = false
})

/** 找到标题块真正所在的滚动容器（编辑区不在 window 上滚动） */
function getScrollContainer(el: HTMLElement): HTMLElement | null {
  let parent = el.parentElement
  while (parent) {
    const style = getComputedStyle(parent)
    if (/(auto|scroll|overlay)/.test(style.overflowY)) return parent
    parent = parent.parentElement
  }
  return null
}

/** 顶部留白：滚动容器顶部的 sticky 工具栏高度 + 12px 呼吸空间 */
function getTopOffset(el: HTMLElement): number {
  const container = getScrollContainer(el)
  const breathing = 12
  if (!container) return breathing
  const toolbar = container.querySelector('.tiptap-toolbar[data-variant="fixed"]')
  if (toolbar instanceof HTMLElement && getComputedStyle(toolbar).position === 'sticky') {
    return toolbar.getBoundingClientRect().height + breathing
  }
  return breathing
}

function goTo(pos: number) {
  const e = editor?.value
  if (!e) return

  // 光标放到标题开头（PM 只会做「就近滚动」，下面再接管真正的定位）
  e.chain().focus().setTextSelection(pos).run()

  const dom = e.view.nodeDOM(pos)
  if (!(dom instanceof HTMLElement)) return

  // scrollIntoView 会自己找正确的可滚动祖先，scroll-margin-top 负责留白
  const offset = getTopOffset(dom)
  dom.style.scrollMarginTop = `${offset}px`
  dom.scrollIntoView({ block: 'start', behavior: 'smooth' })

  window.setTimeout(() => {
    dom.style.removeProperty('scroll-margin-top')
  }, 600)
}
</script>

<template>
  <aside v-if="headings.length && tocFits" class="toc-sidebar">
    <div class="toc-sidebar-title">On this page</div>
    <a
      v-for="(h, i) in headings"
      :key="`${h.pos}-${i}`"
      :class="`level-${h.level}`"
      @click="goTo(h.pos)"
    >
      {{ h.text }}
    </a>
  </aside>
</template>
