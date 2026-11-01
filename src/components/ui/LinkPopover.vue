<script setup lang="ts">
import { computed, ref } from 'vue'
import { injectEditor, useEditorTick } from '../../composables/useEditor'
import { usePopover } from '../../composables/usePopover'
import ToolbarButton from './ToolbarButton.vue'
import TiIcon from './TiIcon.vue'

const props = defineProps<{
  icon: string
  label: string
}>()

const editor = injectEditor()
const tick = useEditorTick(editor)
const { open, triggerRef, panelRef, style, toggle } = usePopover()

const url = ref('')

const active = computed(() => {
  tick.value
  return editor?.value?.isActive('link') ?? false
})

function openPanel() {
  url.value = editor?.value?.getAttributes('link').href ?? ''
  toggle(true)
}

function apply() {
  const e = editor?.value
  if (!e) return
  if (url.value.trim()) {
    e.chain().focus().extendMarkRange('link').setLink({ href: url.value.trim() }).run()
  } else {
    e.chain().focus().unsetLink().run()
  }
  open.value = false
}

function remove() {
  editor?.value?.chain().focus().unsetLink().run()
  open.value = false
}
</script>

<template>
  <div ref="triggerRef" class="tt-popover-trigger">
    <ToolbarButton :icon="icon" :label="label" :active="active" @click="openPanel" />
  </div>

  <Teleport to="body">
    <div v-if="open" ref="panelRef" class="tt-popover-panel" :style="style">
      <div class="tt-link-input-row">
        <input
          v-model="url"
          class="tt-link-input"
          type="url"
          placeholder="Paste a link…"
          @keydown.enter.prevent="apply"
        />
        <button type="button" class="tt-btn" title="Apply" @click="apply">
          <TiIcon name="corner-down-left" class="tt-btn-icon" />
        </button>
        <button type="button" class="tt-btn" title="Remove" @click="remove">
          <TiIcon name="trash" class="tt-btn-icon" />
        </button>
      </div>
    </div>
  </Teleport>
</template>
