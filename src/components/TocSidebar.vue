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

function goTo(pos: number) {
  const e = editor?.value
  if (!e) return
  e.chain().focus().setTextSelection(pos).run()
  const dom = e.view.nodeDOM(pos)
  if (dom instanceof HTMLElement) {
    const top = dom.getBoundingClientRect().top + window.scrollY - 100
    window.scrollTo({ top, behavior: 'smooth' })
  }
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
