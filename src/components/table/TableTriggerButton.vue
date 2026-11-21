<script setup>
import { computed, ref, watch } from 'vue'
import { injectEditor } from '../../composables/useEditor'
import { usePopover } from '../../composables/usePopover'
import TiIcon from '../ui/TiIcon.vue'

const editor = injectEditor()

const maxRows = 8
const maxCols = 8
// 复用链接/颜色弹层的定位：Teleport 到 body，贴边自动翻转/平移，跟随滚动与缩放
const { open, triggerRef, panelRef, style, toggle } = usePopover()
const hovered = ref(null)

const cells = computed(() =>
  Array.from({ length: maxRows * maxCols }, (_, i) => ({ row: Math.floor(i / maxCols), col: i % maxCols })),
)

function isSelected(row, col) {
  return !!hovered.value && row <= hovered.value.row && col <= hovered.value.col
}

function onInsert(row, col) {
  const e = editor?.value
  if (!e || !e.isEditable) return
  e.chain().focus().insertTable({ rows: row + 1, cols: col + 1, withHeaderRow: false }).run()
  open.value = false
  hovered.value = null
}

// 关闭时清掉网格高亮，下次打开从 1×1 开始
watch(open, (value) => {
  if (!value) hovered.value = null
})

const indicatorCols = computed(() => (hovered.value ? hovered.value.col + 1 : 1))
const indicatorRows = computed(() => (hovered.value ? hovered.value.row + 1 : 1))
</script>

<template>
  <div ref="triggerRef" class="table-trigger">
    <button
      type="button"
      class="tt-btn"
      title="Insert table"
      aria-label="Insert table"
      @click="toggle()"
    >
      <TiIcon name="table" class="tt-btn-icon" />
    </button>

    <Teleport to="body">
      <div v-if="open" ref="panelRef" class="table-trigger-popover" :style="style" @mousedown.stop>
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
    </Teleport>
  </div>
</template>
