<script setup lang="ts">
import { ref, watch } from 'vue'
import { injectEditor } from '../composables/useEditor'

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
}

watch(
  () => editor?.value,
  (next, prev) => {
    prev?.off('update', updateToc)
    next?.on('update', updateToc)
    updateToc()
  },
  { immediate: true }
)

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
  <aside v-if="headings.length" class="toc-sidebar">
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
