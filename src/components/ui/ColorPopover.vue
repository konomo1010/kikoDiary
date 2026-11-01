<script setup lang="ts">
import { computed } from 'vue'
import { injectEditor, useEditorTick } from '../../composables/useEditor'
import { usePopover } from '../../composables/usePopover'
import ToolbarButton from './ToolbarButton.vue'

const props = defineProps<{
  mode: 'text' | 'highlight'
  icon: string
  label: string
}>()

const editor = injectEditor()
const tick = useEditorTick(editor)
const { open, triggerRef, panelRef, style, toggle } = usePopover()

const textColors = [
  { name: 'Default', value: '' },
  { name: 'Gray', value: '#787774' },
  { name: 'Brown', value: '#9f6b53' },
  { name: 'Orange', value: '#d9730d' },
  { name: 'Yellow', value: '#cb912f' },
  { name: 'Green', value: '#448361' },
  { name: 'Blue', value: '#337ea9' },
  { name: 'Purple', value: '#9065b0' },
  { name: 'Pink', value: '#c14c8a' },
  { name: 'Red', value: '#d44c47' },
]

const highlightColors = [
  { name: 'Yellow', value: 'var(--tt-color-highlight-yellow)' },
  { name: 'Green', value: 'var(--tt-color-highlight-green)' },
  { name: 'Blue', value: 'var(--tt-color-highlight-blue)' },
  { name: 'Purple', value: 'var(--tt-color-highlight-purple)' },
  { name: 'Red', value: 'var(--tt-color-highlight-red)' },
  { name: 'Gray', value: 'var(--tt-color-highlight-gray)' },
]

const colors = computed(() =>
  props.mode === 'text' ? textColors : highlightColors
)

const active = computed(() => {
  tick.value
  const e = editor?.value
  if (!e) return false
  return props.mode === 'text'
    ? e.isActive('textStyle')
    : e.isActive('highlight')
})

function apply(value: string) {
  const e = editor?.value
  if (!e) return
  if (props.mode === 'text') {
    if (!value) e.chain().focus().unsetColor().run()
    else e.chain().focus().setColor(value).run()
  } else {
    if (!value) e.chain().focus().unsetHighlight().run()
    else e.chain().focus().toggleHighlight({ color: value }).run()
  }
  open.value = false
}
</script>

<template>
  <div ref="triggerRef" class="tt-popover-trigger">
    <ToolbarButton :icon="icon" :label="label" :active="active" @click="toggle()" />
  </div>

  <Teleport to="body">
    <div v-if="open" ref="panelRef" class="tt-popover-panel" :style="style">
      <div class="tt-swatch-row">
        <button
          v-for="c in colors"
          :key="c.name"
          type="button"
          class="tt-swatch"
          :title="c.name"
          :style="{ background: c.value || 'transparent', border: c.value ? undefined : '1px dashed var(--tt-gray-light-a-400)' }"
          @click="apply(c.value)"
        />
      </div>
    </div>
  </Teleport>
</template>
