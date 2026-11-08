<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { injectEditor } from '../../composables/useEditor'
import TiIcon from '../ui/TiIcon.vue'

const editor = injectEditor()

const maxRows = 8
const maxCols = 8
const open = ref(false)
const hovered = ref<{ row: number; col: number } | null>(null)

const cells = computed(() =>
  Array.from({ length: maxRows * maxCols }, (_, i) => ({ row: Math.floor(i / maxCols), col: i % maxCols })),
)

function isSelected(row: number, col: number) {
  return !!hovered.value && row <= hovered.value.row && col <= hovered.value.col
}

function onInsert(row: number, col: number) {
  const e = editor?.value
  if (!e || !e.isEditable) return
  e.chain().focus().insertTable({ rows: row + 1, cols: col + 1, withHeaderRow: false }).run()
  open.value = false
  hovered.value = null
}

function onClickOutside(event: MouseEvent) {
  const root = (document.querySelector('.table-trigger') as HTMLElement | null)
  if (root && !root.contains(event.target as Node)) {
    open.value = false
    hovered.value = null
  }
}

onMounted(() => {
  document.addEventListener('mousedown', onClickOutside)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onClickOutside)
})

const indicatorCols = computed(() => (hovered.value ? hovered.value.col + 1 : 1))
const indicatorRows = computed(() => (hovered.value ? hovered.value.row + 1 : 1))
</script>

<template>
  <div class="table-trigger">
    <button
      type="button"
      class="tt-btn"
      title="Insert table"
      aria-label="Insert table"
      @click="open = !open"
    >
      <TiIcon name="table" class="tt-btn-icon" />
    </button>

    <div v-if="open" class="table-trigger-popover" @mousedown.stop>
      <div
        class="tiptap-table-grid"
        :style="{ '--tt-table-columns': maxCols, '--tt-table-rows': maxRows }"
        @mouseleave="hovered = null"
      >
        <button
          v-for="c in cells"
          :key="`${c.row}-${c.col}`"
          type="button"
          class="tiptap-table-grid-cell"
          :class="{ selected: isSelected(c.row, c.col) }"
          @mouseenter="hovered = c"
          @click="onInsert(c.row, c.col)"
        />
      </div>
      <div class="tiptap-table-size-indicator">
        <div class="tiptap-table-size-indicator-item">
          <span class="tiptap-table-size-indicator-text">{{ indicatorCols }}</span>
        </div>
        <span class="tiptap-table-size-indicator-delimiter">x</span>
        <div class="tiptap-table-size-indicator-item">
          <span class="tiptap-table-size-indicator-text">{{ indicatorRows }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
