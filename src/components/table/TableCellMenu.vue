<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { Editor } from '@tiptap/core'
import { CellSelection, mergeCells, splitCell } from '@tiptap/pm/tables'
import { alignSelectedCells, clearSelectedCells, setCellBackground } from '../../composables/useTableActions'
import { isCellEmpty } from '../../lib/table/tableUtils'
import { TABLE_ALIGN_ITEMS, TABLE_BACKGROUND_COLORS, TABLE_TEXT_COLORS, recentTableColors, addRecentTableColor } from '../../lib/table/colors'
import TiIcon from '../ui/TiIcon.vue'

const props = defineProps<{ editor: Editor }>()
const emit = defineEmits<{ close: [] }>()

const submenu = ref<'color' | 'alignment' | null>(null)
const colorAnchor = ref<DOMRect | null>(null)
const flyoutCenterY = ref<number | null>(null)
const flyoutTop = ref<number | null>(null)
const flyoutRef = ref<HTMLElement | null>(null)

function fitColorFlyout() {
  const el = flyoutRef.value
  const anchor = colorAnchor.value
  if (!el || !anchor) return
  const height = el.offsetHeight
  const maxTop = window.innerHeight - height - 8
  const center = flyoutCenterY.value ?? anchor.top + anchor.height / 2
  flyoutTop.value = Math.min(Math.max(8, center - height / 2), Math.max(8, maxTop))
}

function rememberFlyoutAnchor(trigger: HTMLElement) {
  const menu = trigger.closest('.table-handle-menu-dropdown') as HTMLElement | null
  colorAnchor.value = (menu ?? trigger).getBoundingClientRect()
  const rect = trigger.getBoundingClientRect()
  flyoutCenterY.value = rect.top + rect.height / 2
}

function toggleColor(event: MouseEvent) {
  if (submenu.value === 'color') {
    submenu.value = null
    return
  }
  rememberFlyoutAnchor(event.currentTarget as HTMLElement)
  submenu.value = 'color'
  nextTick(fitColorFlyout)
}

function toggleAlignment(event: MouseEvent) {
  if (submenu.value === 'alignment') {
    submenu.value = null
    return
  }
  rememberFlyoutAnchor(event.currentTarget as HTMLElement)
  submenu.value = 'alignment'
  nextTick(fitColorFlyout)
}

function applyAlign(item: { type: 'text' | 'vertical'; value: string }) {
  run(() => alignSelectedCells(props.editor, item.type, item.value))
}

const colorFlyoutStyle = computed(() => {
  const anchor = colorAnchor.value
  if (!anchor) return {}
  const width = 240
  let left = anchor.right + 6
  if (left + width > window.innerWidth - 8) left = anchor.left - width - 6
  return {
    left: `${Math.max(8, left)}px`,
    top: `${flyoutTop.value ?? anchor.top}px`,
    width: `${width}px`,
  }
})

const canMerge = computed(() => {
  try {
    return mergeCells(props.editor.state, undefined)
  } catch {
    return false
  }
})

const canSplit = computed(() => {
  try {
    return splitCell(props.editor.state, undefined)
  } catch {
    return false
  }
})

const canClear = computed(() => {
  const selection = props.editor.state.selection
  if (!(selection instanceof CellSelection)) return false
  let hasContent = false
  selection.forEachCell((node) => {
    if (!isCellEmpty(node)) hasContent = true
  })
  return hasContent
})

function run(fn: () => boolean) {
  if (fn()) emit('close')
}

function merge() {
  try {
    return mergeCells(props.editor.state, props.editor.view.dispatch.bind(props.editor.view))
  } catch {
    return false
  }
}

function split() {
  try {
    return splitCell(props.editor.state, props.editor.view.dispatch.bind(props.editor.view))
  } catch {
    return false
  }
}

function setTextColor(color: string | null) {
  const chain = props.editor.chain().focus() as any
  if (color == null) {
    if (typeof chain.unsetColor === 'function') chain.unsetColor().run()
  } else if (typeof chain.setColor === 'function') {
    chain.setColor(color).run()
    const label = TABLE_TEXT_COLORS.find((item) => item.value === color)?.label
    if (label) addRecentTableColor({ type: 'text', label, value: color })
  }
  emit('close')
}

function setHighlight(color: string | null) {
  if (color) {
    const label = TABLE_BACKGROUND_COLORS.find((item) => item.value === color)?.label
    if (label) addRecentTableColor({ type: 'background', label, value: color })
  }
  run(() => setCellBackground(props.editor, color))
}

function alignText(value: string) {
  run(() => alignSelectedCells(props.editor, 'text', value))
}

function alignVertical(value: string) {
  run(() => alignSelectedCells(props.editor, 'vertical', value))
}
</script>

<template>
  <div class="table-handle-menu-dropdown cell" @click.stop>
    <button v-if="canMerge" type="button" class="table-handle-menu-item" @click="run(merge)">
      <span class="item-left"><TiIcon name="table" class="menu-icon" /><span>Merge cells</span></span>
    </button>
    <button v-if="canSplit" type="button" class="table-handle-menu-item" @click="run(split)">
      <span class="item-left"><TiIcon name="table" class="menu-icon" /><span>Split cell</span></span>
    </button>

    <button type="button" class="table-handle-menu-item submenu-trigger" @click="toggleColor">
      <span class="item-left"><TiIcon name="text-color" class="menu-icon" /><span>Color</span></span>
      <span class="chev">›</span>
    </button>
    <Teleport to="body">
      <div
        v-if="submenu === 'color'"
        ref="flyoutRef"
        class="table-color-flyout"
        :style="colorFlyoutStyle"
        @mousedown.stop
        @click.stop
      >
        <template v-if="recentTableColors.length">
          <div class="table-color-label">Recent colors</div>
          <button
            v-for="color in recentTableColors"
            :key="`r-${color.type}-${color.label}`"
            type="button"
            class="table-color-option"
            @click="color.type === 'text' ? setTextColor(color.value) : setHighlight(color.value)"
          >
            <span
              v-if="color.type === 'background'"
              class="table-color-swatch"
              :style="{ background: color.value ?? undefined }"
            />
            <span v-else class="color-text-icon" :style="{ color: color.value ?? 'currentColor' }">A</span>
            <span>{{ color.label }}</span>
          </button>
          <div class="table-color-sep" />
        </template>
        <div class="table-color-label">Text color</div>
        <button
          v-for="color in TABLE_TEXT_COLORS"
          :key="`t-${color.label}`"
          type="button"
          class="table-color-option"
          @click="setTextColor(color.value)"
        >
          <span class="color-text-icon" :style="{ color: color.value ?? 'currentColor' }">A</span>
          <span>{{ color.label }}</span>
        </button>
        <div class="table-color-sep" />
        <div class="table-color-label">Background color</div>
        <button
          v-for="color in TABLE_BACKGROUND_COLORS"
          :key="`b-${color.label}`"
          type="button"
          class="table-color-option"
          @click="setHighlight(color.value)"
        >
          <span
            class="table-color-swatch"
            :class="{ none: color.value == null }"
            :style="color.value ? { background: color.value } : undefined"
          >{{ color.value == null ? '×' : '' }}</span>
          <span>{{ color.label }}</span>
        </button>
      </div>
    </Teleport>

    <button type="button" class="table-handle-menu-item submenu-trigger" @click="toggleAlignment">
      <span class="item-left"><TiIcon name="align-left" class="menu-icon" /><span>Alignment</span></span>
      <span class="chev">›</span>
    </button>
    <Teleport to="body">
      <div
        v-if="submenu === 'alignment'"
        ref="flyoutRef"
        class="table-align-flyout"
        :style="colorFlyoutStyle"
        @mousedown.stop
        @click.stop
      >
        <button
          v-for="item in TABLE_ALIGN_ITEMS.slice(0, 3)"
          :key="item.label"
          type="button"
          class="table-color-option"
          @click="applyAlign(item)"
        >
          <TiIcon :name="item.icon" class="menu-icon" />
          <span>{{ item.label }}</span>
        </button>
        <div class="table-color-sep" />
        <button
          v-for="item in TABLE_ALIGN_ITEMS.slice(3)"
          :key="item.label"
          type="button"
          class="table-color-option"
          @click="applyAlign(item)"
        >
          <TiIcon :name="item.icon" class="menu-icon" />
          <span>{{ item.label }}</span>
        </button>
      </div>
    </Teleport>

    <template v-if="canClear">
      <div class="table-handle-menu-sep" />
      <button type="button" class="table-handle-menu-item danger" @click="run(() => clearSelectedCells(editor))">Clear contents</button>
    </template>
  </div>
</template>
